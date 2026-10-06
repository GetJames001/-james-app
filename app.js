const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let events = [];
let liveEvents = [];
let briefingEvents = [];
let tasks = [];
let taskSaving = false;
let removedTask = null;
function taskNotice(message) {
  const notice = document.querySelector("#taskNotice");
  if (notice) notice.textContent = message;
}
async function changeTaskList(change) {
  if (taskSaving) return false;
  const before = structuredClone(tasks);
  taskSaving = true;
  change();
  renderTaskPad();
  const saved = await saveTasks();
  if (!saved) { tasks = before; taskNotice("Could not save the change. Please try again."); }
  taskSaving = false;
  renderTaskPad();
  return saved;
}
async function deleteTask(id) {
  const index = tasks.findIndex(task => task.id === id);
  if (index < 0 || taskSaving) return;
  const record = { task: structuredClone(tasks[index]), index };
  if (await changeTaskList(() => { tasks = tasks.filter(task => task.id !== id); })) {
    removedTask = record;
    taskNotice("Task deleted. You can undo your last deletion until you leave or reload this page.");
    renderTaskPad();
  }
}
async function undoTaskDeletion() {
  if (!removedTask || taskSaving) return;
  const record = removedTask;
  if (await changeTaskList(() => {
    if (!tasks.some(task => task.id === record.task.id)) tasks.splice(Math.min(record.index, tasks.length), 0, record.task);
  })) { removedTask = null; taskNotice("Task restored."); renderTaskPad(); }
}
let activeTaskFilter = "all";
let calendarResizeObserver;
let calendarRelayoutFrame;
let calendarRelayoutForced = false;
let lastCalendarGeometry = '';
let personalMailRefreshController;
let hasSuccessfulPersonalMailLoad = false;
let personalMailStateVersion = 0;
let personalMailMutationPending = 0;
let personalMailMutationQueue = Promise.resolve();
const personalMailStateRequests = new Map();
function updateMailStateControls() {
  const id = sessionStorage.getItem('jamesOpenPersonalMailId');
  const message = (window.personalMicrosoftMessages || []).find(item => item.id === id);
  const button = $('#personalMailReadButton');
  if (button && message) {
    button.disabled = personalMailMutationPending > 0;
    button.textContent = message.isRead === true ? 'Mark unread' : 'Mark read';
  }
}
function mailStateNotice(text, reconnect = false) {
  for (const notice of $$('.mail-state-notice')) {
    notice.replaceChildren(document.createTextNode(text));
    if (reconnect) {
      const link = document.createElement('a');
      link.href = '/api/microsoft/connect?account=personal';
      link.textContent = 'Reconnect Personal Mail';
      notice.append(document.createTextNode(' '), link);
    }
  }
}
function setPersonalMailReadState(messageId, isRead) {
  const key = JSON.stringify([messageId, isRead]);
  if (personalMailStateRequests.has(key)) return personalMailStateRequests.get(key);
  personalMailMutationPending++;
  personalMailStateVersion++;
  updateMailStateControls();
  const request = personalMailMutationQueue.then(async () => {
    mailStateNotice('Updating message status…');
    try {
      const response = await fetch('/api/microsoft/mail?account=personal', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, isRead }), signal: AbortSignal.timeout(15000)
      });
      const data = await response.json();
      if (!response.ok || data.ok !== true || data.messageId !== messageId || data.isRead !== isRead) {
        mailStateNotice(data.error === 'MAIL_PERMISSION_REQUIRED'
          ? 'Reconnect Personal Mail to enable read and unread updates.'
          : 'Could not confirm message status. Refresh Mail or try again.', data.error === 'MAIL_PERMISSION_REQUIRED');
        return;
      }
      window.personalMicrosoftMessages = (window.personalMicrosoftMessages || []).map(message =>
        message.id === messageId ? { ...message, isRead: data.isRead } : message);
      if (data.unreadCountVerified === true && Number.isInteger(data.unreadCount) && data.unreadCount >= 0) {
        $('#personalEmailCount').textContent = `${data.unreadCount} unread`;
        mailStateNotice(isRead ? 'Marked read.' : 'Marked unread.');
      } else {
        mailStateNotice('Message status updated. Refresh Mail to verify the unread count.');
      }
      renderPersonalMicrosoftMail(window.personalMicrosoftMessages, { restoreDetail: false });
    } catch {
      mailStateNotice('Could not confirm message status. Refresh Mail or try again.');
    } finally {
      personalMailMutationPending--;
      personalMailStateVersion++;
      personalMailStateRequests.delete(key);
      updateMailStateControls();
    }
  });
  personalMailMutationQueue = request.catch(() => {});
  personalMailStateRequests.set(key, request);
  return request;
}
let calendarRefreshController;
let calendarSyncState = { hasData:false, state:'loading', complete:false, fetchedAt:null };
let displayedCalendarDate = '';
let knownCalendarSources = new Map();

const mins = (t) => { const [h,m] = t.split(':').map(Number); return (h-7)*60+m; };
const pretty = (t) => { let [h,m] = t.split(':').map(Number); const s = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2,'0')} ${s}`; };
const timeToDate = (t) => { const [h,m] = t.split(':').map(Number); const d = new Date(); d.setHours(h,m,0,0); return d; };

function calendarPixelsPerMinute(calendar) {
  const hour = calendar.querySelector('.hour');
  const configuredHeight = parseFloat(
    getComputedStyle(calendar).getPropertyValue('--calendar-hour-height')
  );
  const hourHeight = configuredHeight || hour?.getBoundingClientRect().height || 60;
  return hourHeight / 60;
}

function calendarEventLayouts(calendarEvents, pixelsPerMinute) {
  const layouts = calendarEvents.map((event, index) => ({
    event,
    index,
    start: Math.max(0, mins(event[0])),
    end: Math.min(720, mins(event[1])),
    lane: 0,
    laneCount: 1
  }));
  const appointments = layouts
    .filter(({ event }) => !event[4])
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let active = [];
  let group = [];

  const finishGroup = () => {
    const laneCount = group.reduce(
      (count, item) => Math.max(count, item.lane + 1),
      1
    );
    group.forEach(item => { item.laneCount = laneCount; });
    group = [];
  };

  appointments.forEach(item => {
    active = active.filter(activeItem => activeItem.end > item.start);
    if (!active.length && group.length) finishGroup();

    const occupiedLanes = new Set(active.map(activeItem => activeItem.lane));
    while (occupiedLanes.has(item.lane)) item.lane += 1;

    active.push(item);
    group.push(item);
  });
  if (group.length) finishGroup();

  return layouts
    .sort((a, b) => a.index - b.index)
    .map(layout => ({
      ...layout,
      top: layout.start * pixelsPerMinute,
      height: Math.max(18, (layout.end - layout.start) * pixelsPerMinute)
    }));
}

function positionEventLane(button, calendar, { lane, laneCount }) {
  button.classList.remove('event-overlap');
  button.style.removeProperty('left');
  button.style.removeProperty('right');
  if (laneCount < 2 || !calendar.clientWidth) return;

  const styles = getComputedStyle(calendar);
  const leftInset = parseFloat(styles.getPropertyValue('--event-left')) || 78;
  const rightInset = parseFloat(styles.getPropertyValue('--event-right')) || 8;
  const gap = 4;
  const availableWidth = calendar.clientWidth - leftInset - rightInset;
  const laneWidth = (availableWidth - gap * (laneCount - 1)) / laneCount;

  button.classList.add('event-overlap');
  button.style.left = `${leftInset + lane * (laneWidth + gap)}px`;
  button.style.right = `${rightInset + (laneCount - lane - 1) * (laneWidth + gap)}px`;
}

function relayoutCalendar({ force = false, allowHidden = false } = {}) {
  const calendar = $('#calendar');
  if (!calendar) return false;

  const visible = calendar.clientWidth > 0 && calendar.getClientRects().length > 0;
  if (!visible && !allowHidden) return false;

  const pixelsPerMinute = calendarPixelsPerMinute(calendar);
  const geometry = `${calendar.clientWidth}:${pixelsPerMinute}`;
  if (visible && !force && geometry === lastCalendarGeometry) return false;

  calendarEventLayouts(events, pixelsPerMinute).forEach(layout => {
    const eventButton = calendar.querySelector(
      `.event[data-event-index="${layout.index}"]`
    );
    if (!eventButton) return;

    eventButton.style.top = `${layout.top}px`;
    eventButton.style.height = `${layout.height}px`;
    positionEventLane(eventButton, calendar, layout);
  });

  const now = new Date();
  const nowMinutes = (now.getHours() - 7) * 60 + now.getMinutes();
  const marker = calendar.querySelector('.now');
  if (marker) {
    marker.style.top = `${Math.max(
      0,
      Math.min(720 * pixelsPerMinute, nowMinutes * pixelsPerMinute)
    )}px`;
  }

  if (visible) lastCalendarGeometry = geometry;
  return true;
}

function scheduleCalendarRelayout(force = false) {
  calendarRelayoutForced ||= force;
  if (calendarRelayoutFrame) return;

  calendarRelayoutFrame = requestAnimationFrame(() => {
    const shouldForce = calendarRelayoutForced;
    calendarRelayoutFrame = undefined;
    calendarRelayoutForced = false;
    relayoutCalendar({ force: shouldForce });
  });
}

function observeCalendarLayout() {
  const calendar = $('#calendar');
  if (!calendar || calendarResizeObserver) return;

  if (typeof ResizeObserver === 'function') {
    calendarResizeObserver = new ResizeObserver(() => scheduleCalendarRelayout());
    calendarResizeObserver.observe(calendar);
  } else {
    calendarResizeObserver = { fallback: true };
    window.addEventListener('resize', () => scheduleCalendarRelayout());
  }
}

function toBriefingEvent(event) {
  const start = new Date(event.start);
  const end = new Date(event.end);
  const formatTime = (date) =>
    date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

  return [
    formatTime(start),
    formatTime(end),
    event.title,
    event.location || event.calendarName || 'Appointment'
  ];
}
function renderTaskPad() {
  const list = $("#taskList");
  if (!list) return;

  const add = $("#taskAddButton");
  if (add) add.disabled = taskSaving;
  const undo = $("#taskUndoButton");
  if (undo) { undo.hidden = !removedTask; undo.disabled = taskSaving; }
  const visibleTasks = tasks.filter(task =>
    activeTaskFilter === "all" || task.domain === activeTaskFilter
  );

  $$(".task-filter").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.taskFilter === activeTaskFilter
    );
  });

  if (!visibleTasks.length) {
    list.innerHTML = `
      <div id="taskEmpty" class="task-empty">
        <b>No tasks yet.</b>
        <span>Tasks James is protecting will appear here.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = "";

  visibleTasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "task-row";
    row.dataset.taskId = task.id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.status === "completed";
    checkbox.disabled = taskSaving;
    checkbox.setAttribute("aria-label", `Complete ${task.title}`);
    checkbox.addEventListener("change", async () => {
      const completed = checkbox.checked;
      await changeTaskList(() => {
        const now = new Date().toISOString();
        task.status = completed ? "completed" : "open";
        task.updatedAt = now;
        task.completedAt = completed ? now : null;
      });
    });

    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("span");
    meta.className = "task-meta";
    meta.textContent = task.dueLabel || "";

    const actions = document.createElement("details");
    actions.className = "task-actions";
    const menu = document.createElement("summary");
    menu.textContent = "•••";
    menu.setAttribute("aria-label", `Actions for ${task.title}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete task";
    remove.disabled = taskSaving;
    remove.addEventListener("click", () => deleteTask(task.id));
    actions.append(menu, remove);
    row.append(checkbox, title, meta, actions);
    list.appendChild(row);
  });
}
async function loadTasks() {
  try {
    const response = await fetch("/api/tasks", {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Tasks request failed with ${response.status}`);
    }

    const data = await response.json();
    tasks = Array.isArray(data.tasks) ? data.tasks : [];
    renderTaskPad();
  } catch (error) {
    console.error("Task load failed:", error);
    tasks = [];
    renderTaskPad();
  }
}
async function saveTasks() {
  try {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tasks }),
    });

    if (!response.ok) {
      throw new Error(`Task save failed with ${response.status}`);
    }

    const data = await response.json();
    tasks = Array.isArray(data.tasks) ? data.tasks : tasks;
    renderTaskPad();
    return true;
  } catch (error) {
    console.error("Task save failed:", error);
    return false;
  }
}
async function createTask() {
  if (taskSaving) return;
  const titleInput = $("#taskTitleInput");
  const domainInput = $("#taskDomainInput");

  const title = titleInput?.value.trim();

  if (!title) {
    titleInput?.focus();
    return;
  }
const now = new Date().toISOString();
  const newTask = {
  id: `task-${Date.now()}`,
  title,
  domain: domainInput?.value === "personal" ? "personal" : "work",
  status: "open",
  dueLabel: "",
  createdAt: now,
  updatedAt: now,
  completedAt: null,
};

  const saved = await changeTaskList(() => tasks.unshift(newTask));

  if (!saved) {
    tasks = tasks.filter(task => task.id !== newTask.id);
    renderTaskPad();
    return;
  }

  titleInput.value = "";
  titleInput.focus();
}
document.addEventListener("DOMContentLoaded", () => {
  $("#taskUndoButton")?.addEventListener("click", undoTaskDeletion);
}, { once: true });
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    $("#taskAddButton")?.addEventListener("click", createTask);
    loadTasks();
  }, { once: true });
} else {
  $("#taskAddButton")?.addEventListener("click", createTask);
  loadTasks();
}
function greetingForHour(hour){
  if(hour < 12) return 'Good Morning, Michael';
  if(hour < 18) return 'Good Afternoon, Michael';
  return 'Good Evening, Michael';
}

function setGreeting(){
  const now = new Date();
  const text = greetingForHour(now.getHours());
  $('#mainGreeting').textContent = text;
  $('#introGreeting').textContent = `${text.replace(', Michael','')}, Michael.`;
  $('#dateTime').textContent = now.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}) + ' · ' + now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
}

function nextAppointment(){
  const now = new Date();
  const appointments = events.filter(e => !e[4]);
 return appointments.find(e => (e[5] ? new Date(e[5].end) : timeToDate(e[1])) > now);
}

function updateHero(){
  if(!calendarSyncState.hasData) {
    $('#nextTitle').textContent=calendarSyncState.state==='loading'?'Checking calendar…':'Calendar unavailable';
    $('#nextType').textContent='No verified calendar result yet.';
    ['countdown','leaveBy','driveTime','traffic'].forEach(id=>$('#'+id).textContent='—');return;
  }
  const appt = nextAppointment();
 if (!appt) {
  $('#nextTitle').textContent = calendarSyncState.complete && calendarSyncState.state!=='stale' ? 'No more timed appointments today' : 'No more timed appointments in available data';
  $('#nextType').textContent = calendarSyncState.complete && calendarSyncState.state!=='stale' ? 'No remaining timed events in the selected Google calendars.' : 'Coverage is incomplete or stale; your calendar may contain more events.';
  $('#countdown').textContent = calendarSyncState.complete && calendarSyncState.state!=='stale' ? 'Done' : '—';
  $('#leaveBy').textContent = '—';
  $('#driveTime').textContent = '—';
   $('#traffic').textContent = '—';
  return;
}
  const travel = events.find(e => e[4] === 'travel' && e[3].includes(appt[2]));
const drive = travel ? (parseInt(travel[3], 10) || 0) : 0;
  const start = appt[5] ? new Date(appt[5].start) : timeToDate(appt[0]);
  const leave = new Date(start.getTime() - drive * 60000);
  const now = new Date();
  const diff = Math.max(0, start - now);
  const hrs = Math.floor(diff / 3600000);
  const min = Math.floor((diff % 3600000) / 60000);
  $('#nextTitle').textContent = appt[2];
  $('#nextType').textContent = `${appt[3]} · ${pretty(appt[0])}`;
  $('#countdown').textContent = start <= now ? 'In progress' : hrs ? `${hrs} hr ${min} min` : `${min} min`;
 $('#leaveBy').textContent = travel ? leave.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : '—';
$('#driveTime').textContent = travel ? `${drive} min` : '—';
  $('#traffic').textContent = '—';
}

function openCalendarEvent(event) {
  panel(event[4]==='travel'?'TRAVEL':'APPOINTMENT',event[2],'');
  const body=$('#panelBody'), detail=document.createElement('div');detail.className='panel-item';
  const time=document.createElement('b');
  time.textContent=event[5] ? `${new Date(event[5].start).toLocaleString()} – ${new Date(event[5].end).toLocaleString()}` : `${pretty(event[0])}–${pretty(event[1])}`;
  const location=document.createElement('span');location.textContent=event[3];
  const source=document.createElement('p');source.textContent=event[5]?.calendarName ? `Source calendar: ${event[5].calendarName}` : 'Google Calendar';
  const readOnly=document.createElement('p');readOnly.textContent='Read-only event. Make changes in your source calendar.';
  detail.append(time,location,source,readOnly);body.append(detail);
}
let appointmentDate=null, appointmentMode='day', quickCalendarMonth=null;
function localAppointmentDate(day=new Date()){return `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;}
function shiftAppointmentDate(value,amount){const day=new Date(value+'T12:00:00');day.setDate(day.getDate()+amount);return localAppointmentDate(day);}
function openAppointmentDate(date,mode='day'){appointmentDate=date;appointmentMode=mode;page('appointments');}
function renderQuickCalendar(){
  const grid=$('#quickCalendarDays');if(!grid)return;
  const today=localAppointmentDate(),maximum=shiftAppointmentDate(today,88),firstMonth=today.slice(0,7),lastMonth=maximum.slice(0,7);
  if(!quickCalendarMonth||quickCalendarMonth<firstMonth||quickCalendarMonth>lastMonth)quickCalendarMonth=firstMonth;
  const first=new Date(quickCalendarMonth+'-01T12:00:00'),count=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
  $('#quickCalendarMonth').textContent=first.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  $('#quickCalendarPrevious').disabled=quickCalendarMonth<=firstMonth;$('#quickCalendarNext').disabled=quickCalendarMonth>=lastMonth;
  grid.replaceChildren();
  for(let i=0;i<first.getDay();i++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');grid.append(blank);}
  for(let day=1;day<=count;day++){
    const date=quickCalendarMonth+'-'+String(day).padStart(2,'0'),button=document.createElement('button'),number=document.createElement('span');
    button.type='button';button.dataset.date=date;button.disabled=date<today||date>maximum;number.textContent=String(day);button.append(number);
    const result=JamesCalendarSync.eventsForDay(liveEvents,new Date(date+'T12:00:00')),hasEvents=result.timed.length+result.allDay.length>0;
    const verified=calendarSyncState.hasData&&calendarSyncState.complete&&calendarSyncState.state==='fresh';
    const label=new Date(date+'T12:00:00').toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    button.setAttribute('aria-label',label+(button.disabled?' · Outside available dates':hasEvents?' · Appointments'+(verified?'':' · Data may be incomplete or stale'):verified?' · No appointments returned':' · Schedule not verified'));
    if(date===today){button.classList.add('is-today');button.setAttribute('aria-current','date');}
    if(hasEvents&&!button.disabled){const dot=document.createElement('i');dot.className='appointment-dot';dot.setAttribute('aria-hidden','true');button.append(dot);}
    button.onclick=()=>openAppointmentDate(date);grid.append(button);
  }
  $('#quickCalendarStatus').textContent=calendarSyncState.state==='loading'?'Checking calendar…':calendarSyncState.state==='stale'?'Refresh failed · Showing saved events':!calendarSyncState.hasData?'Calendar unavailable':!calendarSyncState.complete?'Some events may be missing':'● Appointments · Tap a day to open';
}
function renderAppointmentView(){
  const list=$('#apptList');if(!list)return;
  if(!appointmentDate)appointmentDate=localAppointmentDate();
  const today=localAppointmentDate(),minimum=today,maximum=shiftAppointmentDate(today,88);
  if(appointmentDate<minimum || appointmentDate>maximum)appointmentDate=today;
  const input=$('#appointmentsDate');input.value=appointmentDate;input.min=minimum;input.max=maximum;
  $('#appointmentsPrevious').disabled=appointmentDate<=minimum;$('#appointmentsNext').disabled=appointmentDate>=maximum;
  $('#appointmentsWeek').setAttribute('aria-pressed',String(appointmentMode==='week'));
  $('#appointmentsToday').setAttribute('aria-pressed',String(appointmentMode==='day'&&appointmentDate===today));
  $('#appointmentsTomorrow').setAttribute('aria-pressed',String(appointmentMode==='day'&&appointmentDate===shiftAppointmentDate(today,1)));
  const days=JamesCalendarSync.appointmentDays(appointmentDate,appointmentMode).filter(x=>x.date<=maximum);
  const label=day=>day.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const coverage=calendarSyncState.hasData?(calendarSyncState.state==='fresh'&&calendarSyncState.complete?'Selected Google calendars read successfully.':calendarSyncState.state==='stale'?'Refresh failed; showing previously received events.':'Coverage incomplete; some events may be missing.'):'Calendar unavailable; these dates have not been verified.';
  $('#appointmentsViewStatus').textContent=`${label(days[0].day)}${days.length>1?' through '+label(days.at(-1).day):''} · ${coverage}`;
  list.replaceChildren();
  for(const day of days){
    const group=document.createElement('section');group.className='appointment-day';group.dataset.date=day.date;list.append(group);
    const heading=document.createElement('h4');heading.id='appointment-day-'+day.date;group.setAttribute('aria-labelledby',heading.id);heading.className='appointment-day-heading';heading.textContent=label(day.day);group.append(heading);
    const result=JamesCalendarSync.eventsForDay(liveEvents,day.day);
    for(const event of result.allDay){const article=document.createElement('article'),time=document.createElement('div'),details=document.createElement('div'),title=document.createElement('h4'),source=document.createElement('p');time.textContent='All day';title.textContent=event.title;source.textContent=event.calendarName||'Google Calendar';details.append(title,source);article.append(time,details);group.append(article);}
    for(const event of result.timed){const article=document.createElement('article'),time=document.createElement('div'),details=document.createElement('div'),title=document.createElement('h4'),location=document.createElement('p'),button=document.createElement('button');time.textContent=pretty(event[0]);title.textContent=event[2];location.textContent=event[3];details.append(title,location);button.textContent='Open';button.onclick=()=>openCalendarEvent(event);article.append(time,details,button);group.append(article);}
    if(!result.timed.length&&!result.allDay.length){const empty=document.createElement('p');empty.textContent=calendarSyncState.hasData&&calendarSyncState.complete&&calendarSyncState.state==='fresh'?'No events returned for this date from the selected Google calendars.':'No events available for this date; the schedule is not verified.';group.append(empty);}
  }
}
function buildCalendar(){
  const c=$('#calendar');lastCalendarGeometry='';c.replaceChildren();
  for(let h=7;h<=19;h++) {
    const r=document.createElement('div');r.className='hour';const span=document.createElement('span');
    span.textContent=`${h>12?h-12:h}:00 ${h>=12?'PM':'AM'}`;r.append(span);c.append(r);
  }
  events.forEach((e,index)=>{
    if(e[4]==='open' || mins(e[1])<=0 || mins(e[0])>=720)return;
    const button=document.createElement('button');button.className=`event ${e[4] || ''}`;button.dataset.eventIndex=index;
    if(e[4]==='travel'){button.setAttribute('aria-label',e[3]);button.title=e[3];}
    else {const title=document.createElement('b'),location=document.createElement('small');title.textContent=e[2];location.textContent=e[3];button.append(title,location);}
    button.onclick=()=>openCalendarEvent(e);c.append(button);
  });
  const marker=document.createElement('div');marker.className='now';c.append(marker);relayoutCalendar({force:true,allowHidden:true});
  renderAppointmentView();
  renderQuickCalendar();

}

function page(id){
  sessionStorage.setItem('jamesCurrentPage', id);
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === id));
  if(id === 'briefing') scheduleCalendarRelayout(true);
  if(id === 'appointments')renderAppointmentView();
  if(personalMailRefreshController) personalMailRefreshController.pageChanged();
  if(calendarRefreshController) calendarRefreshController.pageChanged();
  if(id === 'insights'){
    $('#jamesNav').classList.remove('has-recommendation');
    const cue = $('#jamesNav .recommendation-cue');
    if(cue) cue.setAttribute('aria-label','Recommendations reviewed');
  }
}
function panel(k,t,html){ $('#panelKicker').textContent = k; $('#panelTitle').textContent = t; $('#panelBody').innerHTML = html; $('#backdrop').classList.add('open'); }
function closePanel(){ $('#backdrop').classList.remove('open'); }
function speak(text){
  const start = localStorage.getItem('jamesStart') || 'home';
    const script = text || `Good morning, Michael. I have your route starting from ${start}. Your next appointment is ${$('#nextTitle').textContent}. Leave by ${$('#leaveBy').textContent}. Otherwise, your day looks manageable.`;
  if('speechSynthesis' in window){ speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(script); u.rate=.96; u.pitch=.9; speechSynthesis.speak(u); }
  else panel('JAMES','Morning Briefing',`<p>${script}</p>`);
}

let introFinished = false;
let introFallback;

function setOrbState(state='idle'){
  const orb = $('#jamesOrb');
  if(!orb) return;
  orb.classList.remove('listening','speaking','attention');
  if(state !== 'idle') orb.classList.add(state);
}

function finishIntro(startLocation){
  if(introFinished) return;
  introFinished = true;
  sessionStorage.setItem('jamesIntroDate', new Date().toDateString());
  $('#intro').classList.add('hide');
$('#app').classList.remove('frosted');
$('#app').classList.add('clear');
  clearTimeout(introFallback);
  const chosen = startLocation || localStorage.getItem('jamesStart') || 'Home';
  localStorage.setItem('jamesStart', chosen);

  // The answer has done its job: remove the controls and do not repeat it on screen.
  $('#routePrompt').classList.add('answered');
  $('#introSummary').classList.add('quiet');

  const spoken = `Perfect. I've updated today's route from ${chosen.toLowerCase()}.`;
  try { speak(spoken); } catch (e) {}

  // One clean motion: James returns to the light, the orb reforms, briefing appears.
  setTimeout(() => $('#intro').classList.add('phase-return'), 240);
  setTimeout(() => {
    $('#app').classList.remove('frosted');
    $('#app').classList.add('clear');
  }, 850);
  setTimeout(() => $('#intro').classList.add('hide'), 1450);
}

function intro(){
  const introDate = sessionStorage.getItem('jamesIntroDate');

if(introDate === new Date().toDateString()){
  introFinished = true;
  $('#intro').classList.add('hide');
  $('#app').classList.remove('frosted');
  $('#app').classList.add('clear');
  const savedPage = sessionStorage.getItem('jamesCurrentPage') || 'briefing';
page(savedPage);
  return;
}
  const saved = localStorage.getItem('jamesStart');
  const introEl = $('#intro');
  const summary = $('#introSummary');
  const prompt = $('#routePrompt');

  // Phase 1: living orb only. Phase 2: James emerges once from the light.
  // setTimeout(() => introEl.classList.add('phase-james'), 650);
  setTimeout(() => {
    summary.textContent = 'I’ve prepared your briefing.';
    if(saved){
      // Still confirm the starting point each session; plans can change overnight.
      summary.textContent = 'Before I finalize today’s route, where are we starting?';
    } else {
      summary.textContent = 'Before I finalize today’s route, where are we starting?';
    }
  }, 1450);

  // Speech is additive. The visual sequence never waits on autoplay permission.
  const introOrb = $('#intro .orb.big');

if (introOrb) {
  introOrb.onclick = () => {
    const hello = `${$('#introGreeting').textContent} I've prepared your briefing. Before I finalize today's route, where are we starting? Home, office, or somewhere else?`;
    speak(hello);
  };
}

  // Keep the intro waiting for the user's start-location answer. No auto-finish copy.
  prompt.classList.remove('answered');
}function detectUtility(question) {
  const q = String(question || '').toLowerCase();

  if (
    q.includes('what time') ||
    q.includes('current time') ||
    q.includes('time in ')
  ) {
    return 'time';
  }

  if (
    q.includes('weather') ||
    q.includes('temperature') ||
    q.includes('forecast')
  ) {
    return 'weather';
  }

  if (
    q.includes('directions') ||
    q.includes('how far') ||
    q.includes('drive time') ||
    q.includes('route to')
  ) {
    return 'directions';
  }

  if (
    q.includes('score') ||
    q.includes('who won') ||
    q.includes('game tonight')
  ) {
    return 'sports';
  }

  return null;
}function shouldUseGoogleSearch(question) {
  const q = String(question || "").toLowerCase();

  const googleSignals = [
    "news",
    "latest",
    "breaking",
    "headlines",
    "current events",
    "recent developments",
    "what happened today",
    "top stories"
  ];

  return googleSignals.some(signal => q.includes(signal));
}
function shouldUseCouncil(question) {
  const q = String(question || '').toLowerCase();

  const councilSignals = [
    
    'recommend',
    'strategy',
    'strategic',
    'financial',
    'finance',
    'legal',
    'contract',
    'risk',
    'investment',
    'buy this',
    'sell this',
    'business decision',
    'analyze',
    'analyse',
    'compare options',
    'pros and cons',
    'full council',
    'council review'
  ];
const highConsequenceShouldI =
  q.includes('should i') &&
  (
    q.includes('invest') ||
    q.includes('buy') ||
    q.includes('sell') ||
    q.includes('sign') ||
    q.includes('contract') ||
    q.includes('agreement') ||
    q.includes('hire') ||
    q.includes('fire') ||
    q.includes('loan') ||
    q.includes('debt') ||
    q.includes('expand') ||
    q.includes('acquire')
  );

if (highConsequenceShouldI) return true;
  return councilSignals.some(signal => q.includes(signal));
}
function renderCalendarDay() {
  const selected=JamesCalendarSync.eventsForDay(liveEvents,new Date());
  displayedCalendarDate=selected.date;briefingEvents=selected.timed;events=briefingEvents;
  window.liveEvents=liveEvents;window.briefingEvents=briefingEvents;window.allDayEvents=selected.allDay;
  if(selected.invalidCount)calendarSyncState.complete=false;
  const strip=$('#allDayStrip'),ribbon=$('#allDayRibbon');
  if(strip){strip.hidden=!selected.allDay.length;strip.textContent=selected.allDay.length?'ALL DAY — '+selected.allDay.map(e=>e.title).join(' · '):'';}
  if(ribbon)ribbon.hidden=!selected.allDay.length;
  buildCalendar();updateHero();
}
function calendarStatus(text) { const element=$('#calendarSyncStatus');if(element)element.textContent=text;const warning=$('#calendarVisibleWarning');if(warning){const important=/Incomplete coverage|Refresh failed|unavailable|not been verified/i.test(text);warning.hidden=!important;warning.textContent=important?text:'';} }
async function requestGoogleEvents() {
  calendarStatus(calendarSyncState.hasData?'Refreshing Google Calendar; showing last received events…':'Checking Google Calendar…');
  return JamesCalendarSync.readCalendar(fetch);
}
function applyGoogleEvents(data) {
  liveEvents=JamesCalendarSync.mergePartial(liveEvents,data);
  calendarSyncState={hasData:true,state:data.complete===false || data.partial===true?'partial':'fresh',complete:data.complete!==false && data.partial!==true,fetchedAt:data.fetchedAt || new Date().toISOString()};
  const sources=$('#calendarSyncSources');
  if(sources) {
    if(data.complete!==false && data.partial!==true)knownCalendarSources.clear();
    (data.calendars || []).forEach(c=>knownCalendarSources.set(c.id,c.name || 'Unnamed calendar'));
    const names=[...knownCalendarSources.values()];
    sources.textContent=`Google sources: ${names.length?names.join(' · '):(Array.isArray(data.calendars) && calendarSyncState.complete?'No selected non-holiday calendars':'Source names unavailable')} · Display timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Read-only.`;
  }
  renderCalendarDay();
  const timestamp=new Date(calendarSyncState.fetchedAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  const dayLabel=displayedCalendarDate;
  calendarStatus(calendarSyncState.complete ? `Updated ${timestamp}. Showing ${dayLabel}; selected Google calendars read successfully.` : `Incomplete coverage at ${timestamp}. Showing available and previously received events for ${dayLabel}; some source events may be missing or stale.`);
}
function googleEventsFailed() {
  calendarSyncState.state=calendarSyncState.hasData?'stale':'unavailable';
  calendarStatus(calendarSyncState.hasData?'Refresh failed. Keeping previously received events; they may be stale.':'Google Calendar unavailable. Your schedule has not been verified.');
  if(calendarSyncState.hasData)renderCalendarDay();else{updateHero();renderAppointmentView();renderQuickCalendar();}
}
function loadLiveGoogleEvents() { return calendarRefreshController ? calendarRefreshController.refresh('manual') : Promise.resolve({skipped:'not-started'}); }
async function loadWeatherForCoordinates({ latitude, longitude }, tempEl, detailEl) {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}` +
      `&longitude=${longitude}` +
      `&current=temperature_2m,weather_code&temperature_unit=fahrenheit`;

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || !data.current) throw new Error('Weather unavailable');

    tempEl.textContent = `${Math.round(data.current.temperature_2m)}°`;
    const code = data.current.weather_code;

    const condition =
      code === 0 ? 'Clear' :
      code <= 3 ? 'Partly cloudy' :
      code <= 48 ? 'Foggy' :
      code <= 67 ? 'Rain' :
      code <= 77 ? 'Snow' :
      code <= 82 ? 'Rain showers' :
      code <= 86 ? 'Snow showers' :
      code >= 95 ? 'Thunderstorms' :
      'Current conditions';

    detailEl.textContent = condition;
  } catch (error) {
    tempEl.textContent = '—';
    detailEl.textContent = 'Weather unavailable';
    console.error('Could not load live weather:', error);
  }
}

function loadLiveWeather() {
  const tempEl = $('#weatherTemp');
  const detailEl = $('#weatherDetail');

  if (!tempEl || !detailEl) return;

  detailEl.textContent = 'Locating…';

  const showLocationUnavailable = (error) => {
    tempEl.textContent = '—';
    detailEl.textContent = 'Location unavailable';

    if (error) {
      console.warn('Could not determine device location:', error);
    }
  };

  if (!navigator.geolocation) {
    showLocationUnavailable();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => loadWeatherForCoordinates(coords, tempEl, detailEl),
    showLocationUnavailable,
    {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 15 * 60 * 1000
    }
  );
}
function renderPersonalMicrosoftMail(messages = [], { restoreDetail = true } = {}) {
  const list = $('#personalMailMessages');
  if (!list) return;

  list.replaceChildren();

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'panel-item';
    empty.textContent = 'No recent messages.';
    list.appendChild(empty);
    return;
  }

  messages.forEach(message => {
    const row = document.createElement('div');
    row.className = 'panel-item';
    row.dataset.messageId = message.id;

    const subject = document.createElement('b');
    subject.textContent = message.subject || '(No subject)';

    const sender = document.createElement('span');
    sender.textContent = message.sender || 'Unknown sender';

    const preview = document.createElement('span');
    preview.textContent = message.preview || '';

    
const received = document.createElement('span');
received.textContent = message.receivedDateTime
  ? new Date(message.receivedDateTime).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  : '';

if (message.isRead === false) {
  subject.textContent = '● ' + subject.textContent;
}
    row.append(subject, sender, received, preview);
    row.onclick = (event) => {
      sessionStorage.setItem('jamesOpenPersonalMailId', message.id);
  $('#personalMailDetailSubject').textContent =
    message.subject || '(No subject)';

  $('#personalMailDetailMeta').textContent =
    `${message.sender || 'Unknown sender'} · ${
      message.receivedDateTime
        ? new Date(message.receivedDateTime).toLocaleString()
        : ''
    }`;

  const detailBody = $("#personalMailDetailBody");

detailBody.replaceChildren();

const emailFrame = document.createElement("iframe");

emailFrame.setAttribute("sandbox", "");
emailFrame.setAttribute("referrerpolicy", "no-referrer");

emailFrame.style.width = "100%";
emailFrame.style.minHeight = "700px";
emailFrame.style.border = "0";
emailFrame.style.background = "#fff";
emailFrame.style.borderRadius = "8px";

emailFrame.srcdoc =
  message.body ||
  `<html><body><p>${message.preview || "No message content."}</p></body></html>`;

const mailActions = document.createElement("div");
mailActions.className = "personal-mail-actions";
mailActions.setAttribute("role", "group");
mailActions.setAttribute("aria-label", "Message actions");
detailBody.append(mailActions, emailFrame);
const replyButton = document.createElement("button");
replyButton.id = "personalMailReplyButton";
replyButton.type = "button";
replyButton.textContent = "Reply";

replyButton.onclick = () => {
  const existingComposer = $("#personalMailReplyComposer");
  if (existingComposer) existingComposer.remove();

  const composer = document.createElement("div");
  composer.id = "personalMailReplyComposer";

  const replyBox = document.createElement("textarea");
  replyBox.id = "personalMailReplyText";
  replyBox.placeholder = "Write your reply...";
  replyBox.rows = 8;
  replyBox.style.width = "100%";
  replyBox.style.marginTop = "16px";

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.textContent = "Send";
  sendButton.style.marginTop = "10px";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";
  cancelButton.style.margin = "10px 0 0 8px";

 sendButton.onclick = async () => {
  const replyText = replyBox.value.trim();

  if (!replyText) {
    alert("Write a reply first.");
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = "Sending...";

  try {
    const response = await fetch("/api/microsoft/mail?account=personal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messageId: message.id,
        replyText,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data.sent) {
      throw new Error(data.error || "Reply failed.");
    }

    composer.remove();
    alert("Reply sent.");
  } catch (error) {
    console.error("Personal mail reply failed", error);
    alert("James could not send the reply.");
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "Send";
  }
};

  cancelButton.onclick = () => {
    composer.remove();
  };

  composer.append(replyBox, sendButton, cancelButton);
  detailBody.insertBefore(composer, emailFrame);
  replyBox.focus();
};

mailActions.appendChild(replyButton);
const readButton = document.createElement('button');
readButton.id = 'personalMailReadButton';
readButton.type = 'button';
readButton.onclick = () => {
  const current = (window.personalMicrosoftMessages || []).find(item => item.id === message.id);
  if (current) setPersonalMailReadState(message.id, current.isRead !== true);
};
mailActions.appendChild(readButton);
  page('personalMailDetail');
  updateMailStateControls();
  if (!event?.restore && message.isRead === false) setPersonalMailReadState(message.id, true);
};
    list.appendChild(row);
  });
  const savedMailId = sessionStorage.getItem('jamesOpenPersonalMailId');
const savedPage = sessionStorage.getItem('jamesCurrentPage');

if (restoreDetail && savedPage === 'personalMailDetail' && savedMailId) {
  const savedRow = list.querySelector(`[data-message-id="${CSS.escape(savedMailId)}"]`);

  if (savedRow) {
    savedRow.onclick({ restore: true });
  } else {
    sessionStorage.removeItem('jamesOpenPersonalMailId');
    page('personalMail');
  }
}
}
async function requestPersonalMicrosoftMail() {
  if (personalMailMutationPending) throw new Error('Mail status update pending.');
  const version = personalMailStateVersion;
  const response = await fetch('/api/microsoft/mail?account=personal');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Personal Mail refresh failed.');
  if (version !== personalMailStateVersion || personalMailMutationPending) throw new Error('Discarding an older Mail refresh.');
  return data;
}

function applyPersonalMicrosoftMail(data) {
  const personalMailCount = $('#personalEmailCount');
  if (!personalMailCount) return;

  if (!data.connected) {
    personalMailCount.textContent = '—';
    window.personalMicrosoftMessages = [];
    renderPersonalMicrosoftMail([]);
    hasSuccessfulPersonalMailLoad = true;
    return;
  }

  personalMailCount.textContent = `${data.unreadCount} unread`;
  window.personalMicrosoftMessages = Array.isArray(data.messages) ? data.messages : [];
  renderPersonalMicrosoftMail(window.personalMicrosoftMessages);
  hasSuccessfulPersonalMailLoad = true;
}

function handlePersonalMicrosoftMailError(error) {
  console.error('Could not refresh Personal Microsoft Mail:', error);
  if (hasSuccessfulPersonalMailLoad) return;
  const personalMailCount = $('#personalEmailCount');
  if (personalMailCount) personalMailCount.textContent = '—';
}

function loadPersonalMicrosoftMail() {
  if (personalMailRefreshController) {
    return personalMailRefreshController.refresh('manual');
  }
  return requestPersonalMicrosoftMail()
    .then(data => {
      applyPersonalMicrosoftMail(data);
      return data;
    })
    .catch(error => {
      handlePersonalMicrosoftMailError(error);
      return { error };
    });
}
document.addEventListener('DOMContentLoaded', () => {
  calendarRefreshController=JamesCalendarSync.createCalendarRefreshController({
    fetchEvents:requestGoogleEvents,onSuccess:applyGoogleEvents,onError:googleEventsFailed,
    isVisible:()=>document.visibilityState==='visible',
    isCalendarOpen:()=>$('#briefing')?.classList.contains('active') || $('#appointments')?.classList.contains('active'),
    documentTarget:document,windowTarget:window
  });
  calendarRefreshController.start();
  $('#appointmentsToday').addEventListener('click',()=>{appointmentDate=localAppointmentDate();appointmentMode='day';renderAppointmentView();});
  $('#appointmentsTomorrow').addEventListener('click',()=>{appointmentDate=shiftAppointmentDate(localAppointmentDate(),1);appointmentMode='day';renderAppointmentView();});
  $('#appointmentsWeek').addEventListener('click',()=>{appointmentMode=appointmentMode==='week'?'day':'week';renderAppointmentView();});
  $('#appointmentsPrevious').addEventListener('click',()=>{appointmentDate=shiftAppointmentDate(appointmentDate||localAppointmentDate(),-1);renderAppointmentView();});
  $('#appointmentsNext').addEventListener('click',()=>{appointmentDate=shiftAppointmentDate(appointmentDate||localAppointmentDate(),1);renderAppointmentView();});
  $('#appointmentsDate').addEventListener('change',event=>{try{JamesCalendarSync.appointmentDays(event.target.value);appointmentDate=event.target.value;renderAppointmentView();}catch{event.target.value=appointmentDate||localAppointmentDate();}});
  renderAppointmentView();
  ['calendarRefreshButton','appointmentsRefreshButton'].forEach(id=>$('#'+id)?.addEventListener('click',()=>loadLiveGoogleEvents()));
  window.addEventListener('pagehide',()=>calendarRefreshController.stop());
  window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
  loadLiveWeather();
  personalMailRefreshController = PersonalMailRefresh.createPersonalMailRefreshController({
    fetchMail: requestPersonalMicrosoftMail,
    onSuccess: applyPersonalMicrosoftMail,
    onError: handlePersonalMicrosoftMailError,
    isVisible: () => document.visibilityState === 'visible',
    isMailOpen: () =>
      $('#personalMail')?.classList.contains('active') ||
      $('#personalMailDetail')?.classList.contains('active'),
    documentTarget: document,
    windowTarget: window
  });
  personalMailRefreshController.start();
  renderTaskPad();

$$(".task-filter").forEach(button => {
  button.onclick = () => {
    activeTaskFilter = button.dataset.taskFilter || "all";
    renderTaskPad();
  };
});
  $$('[data-start]').forEach(b => b.onclick = () => finishIntro(b.dataset.start));
  buildCalendar();
  observeCalendarLayout();
  $('#quickCalendarPrevious').onclick=()=>{const day=new Date(quickCalendarMonth+'-01T12:00:00');day.setMonth(day.getMonth()-1);quickCalendarMonth=localAppointmentDate(day).slice(0,7);renderQuickCalendar();};
  $('#quickCalendarNext').onclick=()=>{const day=new Date(quickCalendarMonth+'-01T12:00:00');day.setMonth(day.getMonth()+1);quickCalendarMonth=localAppointmentDate(day).slice(0,7);renderQuickCalendar();};
  $('#quickCalendarToday').onclick=()=>openAppointmentDate(localAppointmentDate());
  $('#quickCalendarTomorrow').onclick=()=>openAppointmentDate(shiftAppointmentDate(localAppointmentDate(),1));
  $('#quickCalendarWeek').onclick=()=>openAppointmentDate(localAppointmentDate(),'week');
  updateHero();
  setInterval(() => { setGreeting(); if(calendarSyncState.hasData && displayedCalendarDate!==`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}-${String(new Date().getDate()).padStart(2,'0')}`)renderCalendarDay();else updateHero(); }, 60000);
  $$('nav button[data-page]').forEach(b => b.onclick = () => page(b.dataset.page));
  const logoutButton = $('#logoutButton');
  if (logoutButton) {
    logoutButton.onclick = async () => {
      logoutButton.disabled = true;
      calendarRefreshController.stop();
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin'
        });
      } finally {
        window.location.replace('/login');
      }
    };
  }
  $$('[data-panel]').forEach(b => b.onclick = () => {
    const type = b.dataset.panel;
    const emptyStates = {
      callbacks: ['No callbacks available', 'This view is not connected to a callback source.'],
      emails: ['No email shortcuts available', 'Use Personal Mail for live messages.'],
      proposals: ['No proposals available', 'This view is not connected to a proposal or file source.']
    };
    const [title, detail] = emptyStates[type];
    panel(
      type.toUpperCase(),
      b.textContent.trim(),
      `<div class="panel-item"><b>${title}</b><span>${detail}</span></div>`
    );
  });
  const personalMailRow = $('#personalMailRow');
if (personalMailRow) {
  personalMailRow.onclick = () => page('personalMail');
}
  const personalMailBack = $('#personalMailBack');
if (personalMailBack) {
  personalMailBack.onclick = () => page('briefing');
}
  const personalMailDetailBack = $('#personalMailDetailBack');
if (personalMailDetailBack) {
  personalMailDetailBack.onclick = () => page('personalMail');
}
  $('#close').onclick = closePanel;
  $('#backdrop').onclick = e => { if(e.target === $('#backdrop')) closePanel(); };
  $('#jamesOrb').onclick = () => { setOrbState('listening'); speak(); setTimeout(() => setOrbState('idle'), 3200); };
  
  intro();const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

const voiceJamesButton = $("#voiceJamesButton");

if (SpeechRecognition && voiceJamesButton) {
  const recognition = new SpeechRecognition();

  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceJamesButton.onclick = () => {
    voiceJamesButton.textContent = "🎤 Listening...";
    recognition.start();
  };

  recognition.onresult = (event) => {
  const transcript = event.results[0][0].transcript;
  $("#jamesQuestion").value = transcript;
  voiceJamesButton.textContent = "🎤 Speak";

  setTimeout(() => {
    $("#askJamesButton").click();
  }, 700);
};

  recognition.onerror = () => {
    voiceJamesButton.textContent = "🎤 Speak";
  };

  recognition.onend = () => {
    voiceJamesButton.textContent = "🎤 Speak";
  };
}
  let jamesConversation = [];
  $('#askJamesButton').onclick = async () => {
    const question = $('#jamesQuestion').value.trim();
    if (!question) return;
const utility = detectUtility(question);
const useCouncil = !utility && shouldUseCouncil(question);
const endpoint = useCouncil ? '/api/council' : '/api/fast';
$('#jamesAnswer').textContent = 'James is thinking...';
    try {
      const contextualQuestion = useCouncil
  ? question
  : [
      "Recent conversation:",
      ...jamesConversation.map(
        item => `${item.role === "user" ? "User" : "James"}: ${item.text}`
      ),
      `User: ${question}`,
      "Answer the user's latest message using the recent conversation when relevant."
    ].join("\n");
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
  question: contextualQuestion,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
})
})
          
      const data = await response.json();

      if (!data.ok) {
  $('#jamesAnswer').textContent =
    data.message || 'James could not complete the analysis.';
  return;
}
if (!useCouncil) {
  const answer = data.answer || "James could not produce an answer.";

  $("#jamesAnswer").textContent = answer;

  jamesConversation.push(
    { role: "user", text: question },
    { role: "assistant", text: answer }
  );

  jamesConversation = jamesConversation.slice(-8);

  $("#jamesQuestion").value = "";

  return;
}
const rec = data.final_recommendation;

if (!rec) {
  $('#jamesAnswer').innerHTML =
    '<p>James completed the Council review but did not produce a final recommendation.</p>';
  return;
}

const reasons = Array.isArray(rec.reasons) ? rec.reasons : [];
const keyFacts = Array.isArray(rec.key_facts) ? rec.key_facts : [];
const risks = Array.isArray(rec.risks) ? rec.risks : [];
const changes = Array.isArray(rec.what_would_change_the_answer)
  ? rec.what_would_change_the_answer
  : [];

$('#jamesAnswer').innerHTML = `
  <h4>${rec.recommendation || 'Council recommendation'}</h4>

  <p>
    <strong>Confidence:</strong>
    ${Math.round((rec.confidence?.score || 0) * 100)}%
    · ${rec.confidence?.label || ''}
  </p>

  ${reasons.length ? `
    <h5>Why</h5>
    <ul>${reasons.map(x => `<li>${x}</li>`).join('')}</ul>
  ` : ''}

  ${keyFacts.length ? `
    <h5>Key facts</h5>
    <ul>${keyFacts.map(x => `<li>${typeof x === 'object' ? (x.fact || x.text || x.title || JSON.stringify(x)) : x}</li>`).join('')}</ul>
  ` : ''}

  ${risks.length ? `
    <h5>Risks</h5>
    <ul>${risks.map(x => `<li>${x}</li>`).join('')}</ul>
  ` : ''}

  ${changes.length ? `
    <h5>What would change the answer</h5>
    <ul>${changes.map(x => `<li>${x}</li>`).join('')}</ul>
  ` : ''}
`;

      
    } catch (err) {
      $('#jamesAnswer').textContent = 'James could not reach the Council.';
    }
  };

});
