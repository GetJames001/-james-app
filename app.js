let gmailReviewGeneration = 0;
let attentionScreen = null;
let mailAttentionView = null;
let attentionReader = null;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let events = [];
let liveEvents = [];
let googleEvents = [];
let hotmailEvents = [];
let hotmailRefresh;
function combineCalendarEvents() {
  const key = event => event.iCalUID && JSON.stringify([
    event.iCalUID, event.allDay ? event.start : Date.parse(event.start)
  ]);
  const googleKeys = new Set(googleEvents.map(key).filter(Boolean));
  liveEvents = [...googleEvents, ...hotmailEvents.filter(event => !googleKeys.has(key(event)))];
}
async function refreshHotmailCalendar() {
  if (hotmailRefresh) return hotmailRefresh;
  hotmailRefresh = (async () => {
    const status = $('#hotmailCalendarStatus');
    const connect = $('#hotmailCalendarConnect');
    try {
      const response = await fetch('/api/microsoft/mail?account=personal&calendar=1', {
        cache:'no-store', signal:AbortSignal.timeout(20000)
      });
      const data = await response.json();
      if (connect) connect.hidden = response.ok && Array.isArray(data.events);
      if (!response.ok || !Array.isArray(data.events)) throw Error('Hotmail calendar unavailable');
      hotmailEvents = JamesCalendarSync.mergePartial(hotmailEvents, { ...data, partial:!data.complete });
      combineCalendarEvents();
      renderCalendarDay();
      if (status) status.textContent = data.complete ? 'Hotmail calendar connected.' : 'Hotmail calendar coverage is incomplete.';
    } catch {
      if (status) status.textContent = hotmailEvents.length ? 'Hotmail refresh failed. Showing previously loaded appointments.' : 'Hotmail calendar unavailable.';
    }
  })().finally(()=>{hotmailRefresh=null;});
  return hotmailRefresh;
}
let briefingEvents = [];
let tasks = [];
let taskReadState = "loading";
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
    taskReadState = Array.isArray(data.tasks) ? "available" : "unavailable";
    renderTaskPad();
  } catch (error) {
    console.error("Task load failed:", error);
    tasks = [];
    taskReadState = "unavailable";
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
  $('#introGreeting').textContent = `${text.replace(', Michael','').replace('Morning','morning').replace('Afternoon','afternoon').replace('Evening','evening')}, Michael.`;
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

function openCalendarEvent(row) {
  const event=Array.isArray(row)?row[5]:row;
  const title=event?.title || (Array.isArray(row)?row[2]:'Untitled event');
  panel(Array.isArray(row)&&row[4]==='travel'?'TRAVEL':'APPOINTMENT',title,'');
  const body=$('#panelBody'),detail=document.createElement('div');detail.className='panel-item calendar-event-details';
  const time=document.createElement('b');
  time.textContent=event?.allDay?'All day':event?.start&&event?.end
    ? `${new Date(event.start).toLocaleString()} – ${new Date(event.end).toLocaleString()}`
    : Array.isArray(row)?`${pretty(row[0])}–${pretty(row[1])}`:'Time unavailable';
  detail.append(time);
  const addField=(heading,value)=>{
    if(typeof value!=='string'||!value.trim())return;
    const section=document.createElement('section'),label=document.createElement('strong'),text=document.createElement('p');
    label.textContent=heading;text.textContent=value;section.append(label,text);detail.append(section);
  };
  addField('Location',event?.location || (Array.isArray(row)?row[3]:''));
  addField('Calendar',event?.calendarName || 'Google Calendar');
  addField('Description and agenda',event?.description);
  if(Array.isArray(event?.links)&&event.links.length){
    const section=document.createElement('section'),label=document.createElement('strong'),list=document.createElement('ul');
    label.textContent='Meeting and calendar links';section.append(label);
    for(const item of event.links.slice(0,5)){
      if(typeof item?.url!=='string'||item.url.length>2048)continue;
      let url;try{url=new URL(item.url);}catch{continue;}
      if(url.protocol!=='https:'||!url.hostname||url.username||url.password)continue;
      const li=document.createElement('li'),link=document.createElement('a');
      link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';
      link.textContent=typeof item.label==='string'&&item.label?item.label.slice(0,64):'Open meeting link';
      li.append(link);list.append(li);
    }
    if(list.childElementCount){section.append(list);detail.append(section);}
  }
  const readOnly=document.createElement('p');readOnly.textContent='Read-only event. Make changes in your source calendar.';
  detail.append(readOnly);body.append(detail);
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
    for(const event of result.allDay){const article=document.createElement('article'),time=document.createElement('div'),details=document.createElement('div'),title=document.createElement('h4'),source=document.createElement('p');time.textContent='All day';title.textContent=event.title;source.textContent=event.calendarName||'Google Calendar';details.append(title,source);const button=document.createElement('button');button.type='button';button.textContent='Open';button.onclick=()=>openCalendarEvent(event);article.append(time,details,button);group.append(article);}
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
  if(!window.jamesWorkbenchNavigating && (id==='workbench'||document.getElementById('workbench')?.classList.contains('active'))){window.jamesWorkbenchNavigate?.(id);return;}
  pageNow(id);
}
window.jamesPageNow=pageNow;
function pageNow(id){
  if(id === "attention") openAttentionSavedView();
  else clearAttentionSavedView();
  sessionStorage.setItem('jamesCurrentPage', id);
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === (id==='tasks'?'attention':id==='files'?'workbench':id==='personalMailDetail'?'personalMail':id)));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === id));
  window.dispatchEvent(new Event('james:page-changed'));
  if(id === 'briefing') scheduleCalendarRelayout(true);
  if(id === 'appointments')renderAppointmentView();
  if(id === 'files')document.dispatchEvent(new Event('james:files-opened'));
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
function setOrbState(state='idle'){
  const orb = $('#jamesOrb');
  if(!orb) return;
  orb.classList.remove('listening','speaking','thinking','connecting','muted','attention');
  if(state !== 'idle') orb.classList.add(state);
}

// Today's Perspective uses one checked Covey quotation and clearly
// labeled original James reflections. No generated attributions or network calls.
const JAMES_PERSPECTIVES = Object.freeze([
  Object.freeze({
    text: 'Seek first to understand, then to be understood.',
    author: 'Stephen R. Covey',
    source: 'The 7 Habits of Highly Effective People · Habit 5'
  }),
  Object.freeze({text:'A clear next step beats a crowded to-do list.',author:'James',source:'Original reflection'}),
  Object.freeze({text:'Ask a better question before choosing the answer.',author:'James',source:'Original reflection'}),
  Object.freeze({text:'Progress often starts with one useful conversation.',author:'James',source:'Original reflection'}),
  Object.freeze({text:'Protect the important, not just the urgent.',author:'James',source:'Original reflection'}),
  Object.freeze({text:'Listen closely. Then act with intention.',author:'James',source:'Original reflection'}),
  Object.freeze({text:'Make room today for what matters tomorrow.',author:'James',source:'Original reflection'})
]);
function jamesPerspectiveForDate(date=new Date()){
  // UTC construction from LOCAL calendar parts ensures that the selection is
  // stable throughout the local day, even across DST and iPad reloads.
  const day=Math.floor(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000);
  return JAMES_PERSPECTIVES[((day%JAMES_PERSPECTIVES.length)+JAMES_PERSPECTIVES.length)%JAMES_PERSPECTIVES.length];
}
function renderJamesPerspective(date=new Date()){
  const item=jamesPerspectiveForDate(date);
  const fields=[['perspectiveIntroText','text'],['perspectiveIntroAuthor','author'],['perspectiveIntroSource','source'],
    ['perspectiveBriefText','text'],['perspectiveBriefAuthor','author'],['perspectiveBriefSource','source']];
  for(const [id,key] of fields){
    const node=document.getElementById(id);
    if(node)node.textContent=item[key];
  }
}

function intro(){
  JamesWelcome.start({ onResume: () => {
    let savedPage = 'briefing';
    try { savedPage = sessionStorage.getItem('jamesCurrentPage') || 'briefing'; } catch (_) {}
    if (!document.getElementById(savedPage)?.classList.contains('page')) savedPage = 'briefing';
    page(savedPage);
  }});
}
function detectUtility(question) {
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
  void refreshHotmailCalendar();
  return JamesCalendarSync.readCalendar(fetch);
}
function applyGoogleEvents(data) {
  const diagnostic=$('#calendarFailureDetail');
  if(diagnostic){diagnostic.textContent='';diagnostic.hidden=true;}
  const reconnectLink=$('#googleCalendarConnectLink');if(reconnectLink)reconnectLink.hidden=true;
  googleEvents=JamesCalendarSync.mergePartial(googleEvents,data);
  combineCalendarEvents();
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
function calendarFailureDetail(error) {
  const stages={CONNECTION_STORE:'Could not read the saved Calendar connection.',TOKEN_REFRESH:'Google authorization could not be refreshed.',CALENDAR_LIST:'Could not retrieve the list of calendars.',EVENT_READ:'Could not retrieve calendar events.'};
  const stage=error?.calendarCode==='GOOGLE_CALENDAR_READ_FAILED'?stages[error.calendarStage]:null;
  const status=Number.isInteger(error?.httpStatus)&&error.httpStatus>=400&&error.httpStatus<=599?` HTTP ${error.httpStatus}.`:'';
  return (stage || 'The Calendar request did not return a verified result.')+status;
}
function googleEventsFailed(error) {
  const diagnostic=$('#calendarFailureDetail');
  if(diagnostic){diagnostic.textContent=calendarFailureDetail(error);diagnostic.hidden=false;}
  const reconnectLink=$('#googleCalendarConnectLink');
  if(reconnectLink)reconnectLink.hidden=!(error?.calendarCode==='GOOGLE_CALENDAR_READ_FAILED' && error?.calendarStage==='TOKEN_REFRESH');
  calendarSyncState.state=calendarSyncState.hasData?'stale':'unavailable';
  calendarStatus(calendarSyncState.hasData?'Refresh failed. Keeping previously received events; they may be stale.':'Google Calendar unavailable. Your schedule has not been verified.');
  if(calendarSyncState.hasData)renderCalendarDay();else{updateHero();renderAppointmentView();renderQuickCalendar();}
}
function loadLiveGoogleEvents() { return calendarRefreshController ? calendarRefreshController.refresh('manual') : Promise.resolve({skipped:'not-started'}); }
async function loadWeatherForCoordinates({ latitude, longitude }, tempEl, detailEl, locationLabel = "") {
  try {
    const url =
      `/api/weather?latitude=${latitude}` +
      `&longitude=${longitude}`;

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

    detailEl.textContent = locationLabel ? locationLabel + " · " + condition : condition;
  } catch (error) {
    tempEl.textContent = '—';
    detailEl.textContent = 'Weather unavailable';
    console.error('Could not load live weather:', error);
  }
}

let weatherRefreshInProgress=false;
function loadLiveWeather(requestPermission=false, opening=false) {
  const tempEl = $('#weatherTemp');
  const detailEl = $('#weatherDetail');
  const refresh = $('#weatherEnableLocation');
  if (!tempEl || !detailEl || weatherRefreshInProgress) return;

  if (refresh) refresh.onclick = () => loadLiveWeather(true);
  const finish = () => {
    weatherRefreshInProgress=false;
    if (refresh) {refresh.disabled=false;refresh.hidden=tempEl.textContent!=='—';}
  };
  const restoreWeather = () => {
    let saved;
    try { saved=JSON.parse(localStorage.getItem('jamesWeatherLocation') || sessionStorage.getItem('jamesWeatherLocation')); } catch {}
    if (!saved || Date.now()-saved.savedAt>7*24*60*60*1000) return false;
    weatherRefreshInProgress=true;
    loadWeatherForCoordinates(saved,tempEl,detailEl,'Last known location').finally(finish);
    return true;
  };
  const showLocationUnavailable = error => {
    if (!requestPermission && restoreWeather()) return;
    tempEl.textContent = '—';
    detailEl.textContent = error?.code === 1 ? 'Allow location in browser settings for weather.' : 'Location unavailable';
    finish();
  };
  const locate = () => {
    weatherRefreshInProgress=true;
    if (refresh) refresh.disabled=true;
    detailEl.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      ({coords}) => {
        const saved = JSON.stringify({
          latitude:Number(coords.latitude.toFixed(2)),
          longitude:Number(coords.longitude.toFixed(2)),
          savedAt:Date.now()
        });
        try { localStorage.setItem('jamesWeatherLocation',saved); }
        catch { try { sessionStorage.setItem('jamesWeatherLocation',saved); } catch {} }
        loadWeatherForCoordinates(coords,tempEl,detailEl).finally(finish);
      },
      showLocationUnavailable,
      {enableHighAccuracy:false,timeout:8000,maximumAge:0}
    );
  };
  const needsPermission = () => {
    if (!restoreWeather()) {
      detailEl.textContent = 'Location permission required';
      if (refresh) refresh.hidden=false;
    }
  };
  if (!navigator.geolocation) return showLocationUnavailable();
  if (requestPermission) return locate();
  const handleUnknownPermission = () => {
    if (weatherRefreshInProgress) return;
    if (opening) locate();
    else needsPermission();
  };
  if (!navigator.permissions?.query) return handleUnknownPermission();
  navigator.permissions.query({name:'geolocation'}).then(permission=>{
    if(weatherRefreshInProgress)return;
    if(permission.state==='granted')locate();
    else if(permission.state==='denied') showLocationUnavailable({code:1});
    else handleUnknownPermission();
  }).catch(handleUnknownPermission);
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

const body = message.body || "";
const attachmentList = document.createElement("div");
const inlineImages = new Map();
function renderEmailBody() {
  const parsed = document.implementation.createHTMLDocument("");
  const template = parsed.createElement("template");
  template.innerHTML = body;
  if (!body) template.content.append(document.createTextNode(message.preview || "No message content."));
  for (const img of template.content.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("cid:")) img.setAttribute("src", inlineImages.get(src.slice(4)) || "");
  }
  emailFrame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: https:' +
    '; base-uri \'none\'">' + template.innerHTML;
  if (!body) emailFrame.title = message.preview || "No message content.";
}
renderEmailBody();

const mailActions = document.createElement("div");
mailActions.className = "personal-mail-actions";
mailActions.setAttribute("role", "group");
mailActions.setAttribute("aria-label", "Message actions");
detailBody.append(mailActions, attachmentList, emailFrame);
const attachmentUrl = "/api/microsoft/mail?account=personal&messageId=" + encodeURIComponent(message.id);
async function getAttachment(id) {
  const response = await fetch(attachmentUrl + (id ? "&attachmentId=" + encodeURIComponent(id) : ""), {cache:"no-store"});
  if (!response.ok) throw Error("Attachment unavailable");
  return response.json();
}
getAttachment().then(({attachments}) => {
  for (const file of attachments) {
    if (file.isInline && file.contentId && /^image\/(png|jpeg|gif|webp)$/i.test(file.contentType || "")) {
      getAttachment(file.id).then(saved => {
        if (!emailFrame.isConnected) return;
        inlineImages.set(file.contentId.replace(/^<|>$/g, ""), "data:" + file.contentType + ";base64," + saved.contentBytes);
        renderEmailBody();
      }).catch(()=>{});
      continue;
    }
    if (file.isInline) continue;
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = file.name || "Attachment";
    download.onclick = async () => {
      download.disabled = true;
      try {
        const saved = await getAttachment(file.id);
        const bytes = Uint8Array.from(atob(saved.contentBytes), character => character.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], {type:"application/octet-stream"}));
        const link = document.createElement("a");
        link.href = url;
        link.download = saved.name || "attachment";
        link.click();
        setTimeout(()=>URL.revokeObjectURL(url), 60000);
      } catch { download.textContent = (file.name || "Attachment") + " (retry)"; }
      finally { download.disabled = false; }
    };
    attachmentList.append(download);
  }
}).catch(()=>{ if(attachmentList.isConnected) attachmentList.textContent = "Attachments could not be checked."; });
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
  const response = await fetch('/api/microsoft/mail?account=personal', { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Personal Mail refresh failed.');
  if (version !== personalMailStateVersion || personalMailMutationPending) throw new Error('Discarding an older Mail refresh.');
  return data;
}

let olderMailCursor = null;
let olderMailLoaded = false;
let olderMailLoading = false;
let olderMailGeneration = 0;
function updateOlderMailButton() {
  const button = $('#personalMailOlder');
  if (!button) return;
  button.hidden = !olderMailCursor;
  button.disabled = olderMailLoading;
  button.onclick = async () => {
    if (!olderMailCursor || olderMailLoading) return;
    const generation = olderMailGeneration;
    olderMailLoading = true;
    updateOlderMailButton();
    try {
      const response = await fetch('/api/microsoft/mail?account=personal&cursor=' + encodeURIComponent(olderMailCursor), {cache:'no-store'});
      const data = await response.json();
      if (!response.ok || !data.connected || !Array.isArray(data.messages)) throw Error('Older mail unavailable');
      if (generation !== olderMailGeneration) return;
      const messages = new Map((window.personalMicrosoftMessages || []).map(message => [message.id, message]));
      for (const message of data.messages) if (!messages.has(message.id)) messages.set(message.id, message);
      window.personalMicrosoftMessages = [...messages.values()];
      olderMailLoaded = true;
      olderMailCursor = data.nextCursor;
      renderPersonalMicrosoftMail(window.personalMicrosoftMessages);
      mailAttentionView?.update(window.personalMicrosoftMessages);
    } catch {
      if (generation === olderMailGeneration) mailStateNotice('Older emails could not be loaded. Try again.');
    }
    finally { olderMailLoading = false; updateOlderMailButton(); }
  };
}
function applyPersonalMicrosoftMail(data) {
  const personalMailCount = $('#personalEmailCount');
  if (!personalMailCount) return;

  if (!data.connected) {
    personalMailCount.textContent = 'Not connected';
    olderMailGeneration++;
    olderMailCursor = null;
    olderMailLoaded = false;
    updateOlderMailButton();
    window.personalMicrosoftMessages = [];
    mailAttentionView?.clear();
    renderPersonalMicrosoftMail([]);
    const empty = $('#personalMailMessages .panel-item');
    if (empty) empty.textContent = 'Personal Mail is not connected in this workspace.';
    mailStateNotice('Personal Mail is not connected in this workspace.');
    hasSuccessfulPersonalMailLoad = true;
    return;
  }

  for (const notice of $$('.mail-state-notice')) {
    if (notice.textContent === 'Personal Mail is not connected in this workspace.') notice.textContent = '';
  }
  personalMailCount.textContent = `${data.unreadCount} unread`;
  const latest = Array.isArray(data.messages) ? data.messages : [];
  if (!olderMailLoaded) olderMailCursor = data.nextCursor;
  const messages = new Map(latest.map(message => [message.id, message]));
  if (olderMailLoaded) for (const message of window.personalMicrosoftMessages || []) {
    if (!messages.has(message.id)) messages.set(message.id, message);
  }
  window.personalMicrosoftMessages = [...messages.values()];
  mailAttentionView?.update(window.personalMicrosoftMessages);
  updateOlderMailButton();
  renderPersonalMicrosoftMail(window.personalMicrosoftMessages);
  hasSuccessfulPersonalMailLoad = true;
}

function handlePersonalMicrosoftMailError(error) {
  mailAttentionView?.fail();
  console.error('Could not refresh Personal Microsoft Mail:', error);
  if (hasSuccessfulPersonalMailLoad) return;
  const personalMailCount = $('#personalEmailCount');
  if (personalMailCount) personalMailCount.textContent = '—';
}

function loadPersonalMicrosoftMail(reason = 'manual') {
  if (personalMailRefreshController) {
    return personalMailRefreshController.refresh(reason);
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
async function refreshPersonalInbox(event) {
  const button = event.currentTarget;
  const status = $('#personalMailRefreshStatus');
  button.disabled = true;
  status.textContent = 'Refreshing inbox…';
  try {
    const data = await loadPersonalMicrosoftMail('inbox-button');
    if (data.error) {
      status.textContent = 'Could not refresh the inbox. Try again.';
      return;
    }
    if (data.connected) {
      // Rebuild pagination so deleted or moved messages cannot linger in older pages.
      olderMailGeneration++;
      olderMailLoaded = false;
      applyPersonalMicrosoftMail(data);
      status.textContent = 'Inbox refreshed.';
    } else {
      status.textContent = '';
    }
  } finally {
    button.disabled = false;
  }
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
  ['calendarRefreshButton','appointmentsRefreshButton'].forEach(id=>$('#'+id)?.addEventListener('click',async event=>{
    const button=event.currentTarget, label=button.textContent;
    button.disabled=true;
    button.textContent='Refreshing…';
    try { await Promise.allSettled([refreshHotmailCalendar(),loadLiveGoogleEvents()]); }
    finally { button.textContent=label;button.disabled=false; }
  }));
  window.addEventListener('pagehide',()=>calendarRefreshController.stop());
  window.addEventListener('pageshow',event=>{if(event.persisted)window.location.reload();});
  loadLiveWeather(false, true);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')loadLiveWeather();
  });
  setInterval(()=>{
    if(document.visibilityState==='visible')loadLiveWeather();
  },5*60*1000);
  personalMailRefreshController = PersonalMailRefresh.createPersonalMailRefreshController({
    fetchMail: requestPersonalMicrosoftMail,
    onSuccess: applyPersonalMicrosoftMail,
    onError: handlePersonalMicrosoftMailError,
    isVisible: () => document.visibilityState === 'visible',
    isMailOpen: () =>
      $('#personalMail')?.classList.contains('active') ||
      $('#personalMailDetail')?.classList.contains('active') ||
      $('#attention')?.classList.contains('active'),
    documentTarget: document,
    windowTarget: window
  });
  personalMailRefreshController.start();
  $('#personalMailRefresh').addEventListener('click', refreshPersonalInbox);
  renderTaskPad();

$$(".task-filter").forEach(button => {
  button.onclick = () => {
    activeTaskFilter = button.dataset.taskFilter || "all";
    renderTaskPad();
  };
});
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
  for (const navButton of $$('nav button[data-page]')) {
    const id = navButton.dataset.page;
    const section = document.getElementById(id);
    if (!section || id === 'insights' || id === 'customer-database') continue;
    const help = document.createElement('button');
    help.type = 'button';
    help.textContent = 'Have questions? Ask James';
    help.addEventListener('click', () => {
      page('insights');
      const question = $('#jamesQuestion');
      if (!question || !$('#insights').classList.contains('active')) return;
      if (!question.value.trim()) question.value = 'How do I use ' + navButton.textContent.trim() + ' in James?';
      question.focus();
    });
    section.append(help);
  }

  const logoutButton = $('#logoutButton');
  if (logoutButton) {
    logoutButton.onclick = async () => {
      window.jamesConversationUI?.revoke();
      logoutButton.disabled = true;
      clearAttentionSavedView();
      mailAttentionView?.clear();
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
  
  setGreeting();
  renderJamesPerspective();
  // Refresh when an overnight tablet session resumes or its words are revisited.
  window.addEventListener('focus',()=>renderJamesPerspective());
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')renderJamesPerspective();
  });
  setInterval(renderJamesPerspective,60000);
  intro();
  const jamesLocalDay=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const readJamesCalendar=date=>{
    try{JamesCalendarSync.appointmentDays(date);}catch{return {status:'invalid_date'};}
    const day=new Date(date+'T12:00:00'),now=new Date(),lower=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1),upper=new Date(now.getFullYear(),now.getMonth(),now.getDate()+89);
    if(day<lower||day>upper)return {status:'outside_loaded_range',date,message:'This date has not been read. The current connected calendar reader covers approximately today through the next 89 days.'};
    const selected=JamesCalendarSync.eventsForDay(liveEvents,day),rows=[...selected.timed.map(row=>row[5]),...selected.allDay];
    return {date,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,google:{...calendarSyncState},hotmail:$('#hotmailCalendarStatus')?.textContent||'Not checked',events:rows.slice(0,50).map(e=>({title:String(e.title||'').slice(0,200),start:e.start,end:e.end,location:String(e.location||'').slice(0,300),allDay:e.allDay})),truncated:rows.length>50,totalAvailable:rows.length};
  };
  const readJamesBriefing=()=>({
    localTime:new Date().toLocaleString(),calendar:readJamesCalendar(jamesLocalDay(new Date())),
    perspective:jamesPerspectiveForDate(),tasks:{status:taskReadState,items:tasks.slice(0,60).map(task=>({title:String(task.text||task.title||'').slice(0,300),completed:task.status==='completed'})),truncated:tasks.length>60},
    weather:{temperature:$('#weatherTemp')?.textContent,detail:$('#weatherDetail')?.textContent},
    mail:{personalUnread:$('#personalEmailCount')?.textContent||'Unavailable',workUnread:$('#workEmailCount')?.textContent||'Unavailable'},
    travel:{connected:false,calendarWrites:false,departureAddressVerified:false},
    attention:'Not scanned for this briefing; do not infer no urgent messages.'
  });
  const getJamesContext=()=>({page:document.querySelector('.page.active')?.id||'briefing',localTime:new Date().toLocaleString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,calendar:readJamesCalendar(jamesLocalDay(new Date())),travel:{connected:false,calendarWrites:false}});
  window.jamesConversationUI=window.JamesConversationUI.mount({input:$('#jamesQuestion'),answer:$('#jamesAnswer'),askButton:$('#askJamesButton'),stopInput:()=>{window.jamesVoice?.close();window.speechSynthesis?.cancel();},getContext:getJamesContext,navigate:async door=>{const id=door==='calendar'?'appointments':door;if(id==='workbench'||document.getElementById('workbench')?.classList.contains('active'))return await window.jamesWorkbenchNavigate?.(id);page(id);return true;},chooseEndpoint:question=>!detectUtility(question)&&shouldUseCouncil(question)?'/api/council':'/api/fast'});
  mailAttentionView=window.JamesMailAttention.mount($('#mailAttentionView'),{
    refresh:async()=>{},
    readSaved:async()=>{const response=await fetch('/api/attention',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error('Saved review unavailable');return (await response.json()).mailReview;},
    saveReview:async()=>{const response=await fetch('/api/attention/scan',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw Error('Mail review could not be saved');},
    review:async id=>{if(id.startsWith('gmail:')){
      const version=personalMailStateVersion,generation=++gmailReviewGeneration;sessionStorage.removeItem('jamesOpenPersonalMailId');
      $('#personalMailDetailSubject').textContent='Gmail message';$('#personalMailDetailMeta').textContent='Read only';$('#personalMailDetailBody').textContent='Loading Gmail message…';page('personalMailDetail');
      try{
        const response=await fetch('/api/google/gmail/messages?messageId='+encodeURIComponent(id.slice(6)),{credentials:'same-origin',cache:'no-store'}),data=await response.json();
        if(!response.ok||data.message?.id!==id)throw Error();
        if(version!==personalMailStateVersion||generation!==gmailReviewGeneration||!$('#personalMailDetail').classList.contains('active'))return;
        $('#personalMailDetailSubject').textContent=data.message.subject;
        $('#personalMailDetailMeta').textContent='Gmail · '+data.message.sender+' · Read only';
        const text=document.createElement('pre');text.style.whiteSpace='pre-wrap';text.textContent=data.message.bodyText;
        const notice=document.createElement('p');notice.textContent='Gmail reading only. Plain-text content is shown; HTML-only messages may show a preview. Attachments, rich formatting, sending and read-state changes are not connected here.';
        $('#personalMailDetailBody').replaceChildren(notice,text);page('personalMailDetail');
      }catch{if(version!==personalMailStateVersion||generation!==gmailReviewGeneration||!$('#personalMailDetail').classList.contains('active'))return;page('personalMail');mailStateNotice('The Gmail source could not be opened. Its saved review item is retained.');}
      return;
    }page('personalMail');let row=[...document.querySelectorAll('#personalMailMessages [data-message-id]')].find(node=>node.dataset.messageId===id);if(!row){try{const response=await fetch('/api/microsoft/mail?account=personal&readMessageId='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'});const data=await response.json();if(!response.ok||data.message?.id!==id)throw Error();window.personalMicrosoftMessages=[...(window.personalMicrosoftMessages||[]),data.message];renderPersonalMicrosoftMail(window.personalMicrosoftMessages,{restoreDetail:false});row=[...document.querySelectorAll('#personalMailMessages [data-message-id]')].find(node=>node.dataset.messageId===id);}catch{mailStateNotice('The source email could not be opened. Its saved review item is retained.');return;}}if(row)row.click();},
    draft:item=>{page('tasks');const field=$('#taskTitleInput');if(field.value.trim()){taskNotice('Your unsaved task is retained. Finish it before drafting another.');field.focus();return;}field.value='Review email: '+item.subject;$('#taskDomainInput').value='personal';taskNotice('Task draft only. Review the original email, then choose Add task to save.');field.focus();}
  });
  if(window.personalMicrosoftMessages?.length)mailAttentionView.update(window.personalMicrosoftMessages);
  for(const button of document.querySelectorAll('[data-action-page]'))button.onclick=()=>page(button.dataset.actionPage);
  $('#workbenchFiles').onclick=()=>page('files');
  $('#filesWorkbenchBack').onclick=()=>page('workbench');
  window.jamesVoice=window.JamesVoiceSession.mount({ui:window.jamesConversationUI,orb:$('#jamesOrb'),button:$('#voiceJamesButton'),setState:setOrbState,readBriefing:readJamesBriefing,readCalendar:async date=>{try{applyGoogleEvents(await JamesCalendarSync.readCalendar(fetch));await refreshHotmailCalendar();}catch{calendarSyncState.state=calendarSyncState.hasData?'stale':'unavailable';}return readJamesCalendar(date);}});
  window.addEventListener('pagehide',()=>window.jamesConversationUI?.suspend());
});


(function(root){
 'use strict';
 function createAttentionScreen(container,{read}){
  const doc=container.ownerDocument;let last=null,epoch=0,refreshButton=null;
  function node(tag,text){const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  // Keep the refresh control mounted while its contents update; replacing a focused
  // button during key activation can blur it after the newly-created button is focused.
  const contentRoot=node('div');
  container.replaceChildren(contentRoot);
  function render(failed){
   contentRoot.replaceChildren();contentRoot.append(node('h2','Saved attention review'));
   const status=node('p',failed?(last?'Could not refresh. Showing previously loaded items.':'Attention unavailable. Try again.'):((!last||last.status==='not_checked')?'Not checked yet.':'Known items needing your attention.'));
   status.setAttribute('role','status');contentRoot.append(status);
   if(last){
    if(last.evaluatedAt)contentRoot.append(node('p','Evaluated: '+last.evaluatedAt));
    for(const c of last.coverage)contentRoot.append(node('p','Checked scope: '+c.label));
    if(last.coverage.length===0)contentRoot.append(node('p','Email coverage has not been established.'));
    for(const s of last.sourceHealth)contentRoot.append(node('p',(failed?'stale':s.status)+' · Last successful scan: '+(s.lastSuccessfulScanAt||'Not available')));
    if(!last.attentionItems.length&&last.status!=='not_checked')contentRoot.append(node('p','No known items in this saved view. Other mail may not have been checked.'));
    const list=node('ul');
    for(const item of last.attentionItems){
     const li=node('li');li.append(node('h2',item.title));
     li.append(node('p',item.deadlineStatus==='exact'?'Due: '+item.deadline:item.deadlineStatus==='none'?'No deadline stated':'Deadline needs review'));
     for(const url of item.evidenceLinks){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)continue;const a=node('a','View source email');a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';li.append(a);}catch{}}
     list.append(li);
    }contentRoot.append(list);
    if(last.needsReview.length)contentRoot.append(node('p',last.needsReview.length+' evidence items need review.'));
   }
   if(!refreshButton){
    refreshButton=node('button','Refresh saved view');
    refreshButton.type='button';
    refreshButton.addEventListener('click',()=>void refreshView());
    container.append(refreshButton);
   }
  }
  async function refreshView(){const current=++epoch;try{const data=await read();if(current!==epoch)return;if(data?.schemaVersion!==1||!['available','not_checked'].includes(data.status)||!Number.isSafeInteger(data.revision)||!['attentionItems','sourceHealth','needsReview','coverage'].every(k=>Array.isArray(data[k])))throw Error('INVALID_RESPONSE');if(!data.attentionItems.every(i=>typeof i?.title==='string'&&['exact','none','unknown'].includes(i.deadlineStatus)&&Array.isArray(i.evidenceLinks))||!data.coverage.every(c=>typeof c?.label==='string'&&c.mailboxWide===false)||!data.sourceHealth.every(s=>typeof s?.status==='string'))throw Error('INVALID_ITEMS');if(data.status==='not_checked'&&(data.revision!==0||['attentionItems','sourceHealth','needsReview','coverage'].some(k=>data[k].length)))throw Error('INVALID_NOT_CHECKED');if(data.status==='available'&&data.revision<1)throw Error('INVALID_REVISION');if(last&&data.revision<last.revision)throw Error('OLD_REVISION');last=data;render(false);}catch{if(current===epoch)render(true);}}
  function clear(){++epoch;last=null;render(false);}
  render(false);return {refresh:refreshView,clear};
 }
 if(typeof module!=='undefined')module.exports={createAttentionScreen};else root.createAttentionScreen=createAttentionScreen;
})(globalThis);

// Attention transport owns only its saved-view request, never Mail refresh.
function createAttentionSavedReader({fetchImpl=fetch,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let active=null;
 function cancel(){if(active){active.abort();active=null;}}
 async function read(){
  cancel();const controller=new AbortController();active=controller;
  const timer=setTimer(()=>controller.abort(),10000);
  try{
   const response=await fetchImpl('/api/attention',{method:'GET',credentials:'same-origin',cache:'no-store',signal:controller.signal});
   if(!response.ok)throw new Error('Attention unavailable');
   return await response.json();
  }finally{clearTimer(timer);if(active===controller)active=null;}
 }
 return {read,cancel};
}
function clearAttentionSavedView(){
 if(attentionReader)attentionReader.cancel();
 if(attentionScreen)attentionScreen.clear();
}
function openAttentionSavedView(){
 const container=document.querySelector('#attentionView');
 if(!container)return;
 if(!attentionReader)attentionReader=createAttentionSavedReader();
 if(!attentionScreen)attentionScreen=createAttentionScreen(container,{read:attentionReader.read});
 void attentionScreen.refresh();
}


/* Customer Activity: explicit outcomes, authenticated persistence, no inferred visits. */
function initCustomerActivity() {
 const $=id=>document.getElementById(id),overlay=$('customerActivityOverlay');
 if(!overlay)return;
 const openButton=$('customerActivityOpen'),closeButton=$('customerActivityClose'),save=$('customerDemoKeepDraft'),reload=$('customerReload'),add=$('customerAdd'),status=$('customerDraftStatus');
 const fields={contactId:$('activityContact'),nextKind:$('customerNextKind'),nextDetails:$('customerNextDetailsText'),nextWhen:$('customerNextWhen'),notes:$('customerDemoOutcome'),outcome:$('customerOutcomeKind'),when:$('customerOccurredAt')};
 const labels={met:'Met in person',attempted:'Attempted visit',not_available:'Contact unavailable',phone:'Phone contact',email:'Email contact',other:'Other'};
 let doc=null,selected=null,busy=false,uncertain=false,returnFocus=null,epoch=0;
 const drafts=new Map(),companyDrafts=new Map(),companyDirty=new Set();
 let pending=null,savingAll=false,remindersStale=false,reminderSignature='',reminderSessionExpired=false;
 let linkedSource=null,legacyBefore=null;
 let practiceMode=false;
 let practiceDoc={schemaVersion:2,revision:0,activities:[],customers:[
  ['Silver Mesa Facilities','Alex Example','Jordan Example'],
  ['Desert Willow Hospitality','Taylor Example','Morgan Example'],
  ['Canyon Ridge Logistics','Casey Example','Riley Example'],
  ['Suncrest Property Services','Jamie Example','Drew Example'],
  ['Blue Horizon Manufacturing','Avery Example','Quinn Example']
 ].map(([name,first,second],i)=>({id:'practice-company-'+i,name,phone:'702-555-01'+String(i).padStart(2,'0'),address:'Fictional site '+(i+1)+' — example only',source:'practice',contacts:[first,second].map((name,j)=>({id:'practice-contact-'+i+'-'+j,name,phone:'702-555-01'+String(i*2+j+10).padStart(2,'0'),email:'contact'+j+'@example.com'}))}))};
 const uuid=()=>crypto.randomUUID();
 const announce=text=>{status.textContent=text;};
 function actionTarget(kind,company,person,details=''){
  const phone=person?.phone||company?.phone||'',email=person?.email?.trim()||'';
  if(kind==='Email'){const recipient=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';return 'mailto:'+encodeURIComponent(recipient)+'?subject='+encodeURIComponent(details||('Follow-up'+(company?.name?' — '+company.name:'')));}
  if(['Call','Text'].includes(kind)&&phone.replace(/[^0-9]/g,''))return (kind==='Call'?'tel:':'sms:')+phone.replace(/[^+0-9]/g,'');
  return '';
 }
 function updateNext(){
  const kind=fields.nextKind.value,active=!!kind&&kind!=='No follow-up needed';
  $('customerNextDetails').hidden=!active;
  const c=companyDrafts.get(selected)||doc?.customers.find(c=>c.id===selected),person=c?.contacts?.find(p=>p.id===fields.contactId.value),link=$('customerNextOpen');
  const target=actionTarget(kind,c,person,fields.nextDetails.value);
  link.hidden=!active||!target;link.textContent=kind==='Email'?'Open email draft':kind==='Text'?'Open text draft':'Open phone';
  if(target)link.href=target;else link.removeAttribute('href');
  $('customerNextOpenHelp').textContent=active&&kind==='Email'?(target.startsWith('mailto:?')?'Enter the recipient in the email draft.':'To: '+person.email):'';
 }
 function followUpText(a){return a.nextAction? a.nextAction==='No follow-up needed'?'No follow-up needed':(a.followUpCompletedAt?'Follow-up completed: ':'Pending: ')+a.nextAction+(a.nextActionDetails?' — '+a.nextActionDetails:'')+(a.nextActionAt?' · '+new Date(a.nextActionAt).toLocaleString():'')+(a.remindAt?' · Reminder moved to '+new Date(a.remindAt).toLocaleString():''):'';}
 const localDateValue=date=>new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
 function renderReminders(){
  if(linkedSource)return;
  const items=(doc?.activities||[]).filter(a=>a.nextActionAt&&!a.followUpCompletedAt&&a.nextAction!=='No follow-up needed').sort((a,b)=>(a.remindAt||a.nextActionAt).localeCompare(b.remindAt||b.nextActionAt));
  const due=items.filter(a=>Date.parse(a.remindAt||a.nextActionAt)<=Date.now());
  $('customerReminders').hidden=practiceMode||(!items.length&&!remindersStale&&!uncertain);
  const signature=JSON.stringify([practiceMode,remindersStale,uncertain,busy,savingAll,items,doc?.customers,due.map(a=>a.id)]);
  if(signature===reminderSignature)return;reminderSignature=signature;
  const list=$('customerReminderList'),focused=document.activeElement?.dataset?.reminderControl;
  const editorState=new Map([...list.querySelectorAll('[data-follow-up-id]')].map(row=>[row.dataset.followUpId,{open:row.querySelector('details')?.open,value:row.querySelector('input')?.value}]));
  list.replaceChildren();
  $('customerReminderSummary').textContent=(practiceMode?'Practice follow-ups':'Customer follow-ups')+' · '+due.length+' due · '+(items.length-due.length)+' upcoming';
  $('customerReminderStatus').textContent=reminderSessionExpired?'Sign in again to load your follow-ups.':remindersStale?(doc?'Could not refresh follow-ups. Previously loaded reminders remain visible and may be out of date.':'Could not load follow-ups. No verified result is available.'):uncertain?'Follow-up status is not confirmed. Check again before repeating an update.':due.length?due.length+' follow-up'+(due.length===1?' is':'s are')+' due.':items.length?'Your saved follow-ups are listed below.':'No timed follow-ups saved in this view.';
  $('customerReminderRetry').hidden=!remindersStale&&!uncertain;
  const alert=reminderSessionExpired?'Sign in again to refresh customer reminders.':remindersStale?'Customer reminders could not refresh; check their status.':uncertain?'Customer follow-up update not confirmed.':due.length?(practiceMode?'Practice: ':'')+due.length+' customer follow-up'+(due.length===1?' is':'s are')+' due.':'';
  if($('customerReminderAlert').textContent!==alert)$('customerReminderAlert').textContent=alert;
  for(const a of items){
   const c=doc.customers.find(c=>c.id===a.customerId),person=c?.contacts?.find(p=>p.id===a.contactId),row=document.createElement('section'),title=document.createElement('h4'),detail=document.createElement('p'),actions=document.createElement('div');
   const isDue=Date.parse(a.remindAt||a.nextActionAt)<=Date.now();row.className='customer-reminder-item';row.dataset.followUpId=a.id;title.textContent=(isDue?'Due · ':'Upcoming · ')+(c?.name||'Company');detail.textContent=a.nextAction+' — '+a.nextActionDetails+' · '+new Date(a.remindAt||a.nextActionAt).toLocaleString();row.append(title,detail);actions.className='customer-actions';
   const target=actionTarget(a.nextAction,c,person,a.nextActionDetails);
   if(target){const link=document.createElement('a');link.href=target;link.textContent=a.nextAction==='Email'?'Open email draft':a.nextAction==='Text'?'Open text draft':'Open phone';actions.append(link);}
   const view=document.createElement('button');view.type='button';view.textContent='View company';view.dataset.reminderControl=a.id+'-view';view.disabled=busy||savingAll;view.onclick=()=>{remember();selected=a.customerId;returnFocus=view;overlay.hidden=false;render();closeButton.focus();};actions.append(view);row.append(actions);
   const edit=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Complete or reschedule';edit.append(summary);
   const complete=document.createElement('button');complete.type='button';complete.textContent='Confirm follow-up completed';complete.dataset.reminderControl=a.id+'-complete';complete.disabled=busy||savingAll||uncertain;complete.onclick=()=>commit({type:'update_followup',followUp:{id:a.id,operation:'complete',at:new Date().toISOString()}});edit.append(complete);
   const label=document.createElement('label'),input=document.createElement('input'),move=document.createElement('button');label.textContent='New reminder date and time';input.type='datetime-local';input.value=localDateValue(new Date(Date.now()+20*60000));input.dataset.reminderControl=a.id+'-time';label.append(input);edit.append(label);move.type='button';move.textContent='Save reminder time';move.disabled=busy||savingAll||uncertain;move.onclick=()=>{const date=new Date(input.value);if(!Number.isFinite(+date)||+date<=Date.now()){$('customerReminderStatus').textContent='Choose a future reminder date and time.';input.focus();return;}commit({type:'update_followup',followUp:{id:a.id,operation:'reschedule',at:date.toISOString()}});};edit.append(move);const prior=editorState.get(a.id);if(prior){edit.open=prior.open;input.value=prior.value;}row.append(edit);list.append(row);
  }
  if(focused)list.querySelector('[data-reminder-control="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
 }
 $('customerReminderRetry').onclick=()=>load();
 for(const button of $('customerQuickTimes').querySelectorAll('button'))button.onclick=()=>{if(button.dataset.custom){fields.nextWhen.focus();return;}fields.nextWhen.value=localDateValue(new Date(Date.now()+Number(button.dataset.minutes)*60000));remember();announce('Follow-up time selected.');};
 function remember(){
  if(!selected)return;
  drafts.set(selected,Object.fromEntries(Object.entries(fields).map(([k,el])=>[k,el.value])));
  // Read actual field values too: autofill/dictation need not emit an input event.
  const draft=companyDrafts.get(selected);
  if(draft){
   const changes={name:$('companyName').value,phone:$('companyPhone').value,address:$('companyAddress').value};
   let changed=Object.entries(changes).some(([k,v])=>v!==(draft[k]||''));
   Object.assign(draft,changes);
   [...$('companyContacts').querySelectorAll('fieldset')].forEach((row,i)=>{
    const person=draft.contacts[i];if(!person)return;
    [...row.querySelectorAll('input')].forEach((el,j)=>{const key=['name','phone','email'][j];if(el.value!==(person[key]||''))changed=true;person[key]=el.value;});
   });
   if(changed)companyDirty.add(selected);
  }
 }
 function controls(){const locked=busy||savingAll;$('customerModeSwitch').disabled=locked||uncertain||!!linkedSource;for(const el of $('companyEditor').querySelectorAll('input,button'))el.disabled=locked||uncertain||!selected||!!linkedSource;save.disabled=locked||uncertain||!doc||!selected;add.disabled=locked||uncertain||!doc||!!linkedSource;reload.disabled=locked||savingAll;reload.hidden=!uncertain;$('customerCloseSave').disabled=locked||uncertain;$('customerKeepEditing').disabled=locked;for(const b of $('customerDemoList').querySelectorAll('button'))b.disabled=locked;for(const el of Object.values(fields))el.disabled=locked||uncertain||!selected;$('customerNewName').disabled=locked||uncertain||!!linkedSource;for(const b of $('customerQuickTimes').querySelectorAll('button'))b.disabled=locked||uncertain;$('customerExitDraft').disabled=locked;renderReminders();}
 function companyDraft(c){
  if(!c)return null;
  if(!companyDrafts.has(c.id)||!companyDirty.has(c.id))companyDrafts.set(c.id,{...c,contacts:(c.contacts|| (c.contact?[{id:uuid(),name:c.contact,phone:c.phone||'',email:''}]:[])).map(person=>({...person}))});
  return companyDrafts.get(c.id);
 }
 function renderCompany(c){
  const draft=companyDraft(c);
  $('companyEditStatus').textContent=companyDirty.has(c?.id)?'Unsaved company details.':'';
  for(const [id,key] of [['companyName','name'],['companyPhone','phone'],['companyAddress','address']]){
   $(id).value=draft?.[key]||'';
   $(id).oninput=()=>{draft[key]=$(id).value;companyDirty.add(c.id);$('companyEditStatus').textContent='Unsaved company details.';updateNext();};
  }
  $('companyContacts').replaceChildren();
  for(const person of draft?.contacts||[]){
   const row=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Contact';row.append(legend);
   for(const [key,title,max] of [['name','Name',150],['phone','Phone',80],['email','Email',254]]){
    const label=document.createElement('label'),input=document.createElement('input');label.textContent=title;input.value=person[key]||'';input.maxLength=max;input.type=key==='phone'?'tel':key==='email'?'email':'text';
    input.oninput=()=>{person[key]=input.value;companyDirty.add(c.id);$('companyEditStatus').textContent='Unsaved company details.';updateNext();};label.append(input);row.append(label);
   }
   $('companyContacts').append(row);
  }
 }
 $('companyAddContact').onclick=()=>{const c=doc?.customers.find(c=>c.id===selected);if(!c)return;const draft=companyDraft(c);if(draft.contacts.length>=50){announce('This company already has 50 contacts.');return;}companyDirty.add(c.id);draft.contacts.push({id:uuid(),name:'',phone:'',email:''});renderCompany(c);controls();$('companyContacts').lastElementChild?.querySelector('input')?.focus();};
 $('companySave').onclick=()=>{
  const draft=companyDrafts.get(selected);if(!draft)return;
  if(!draft.name.trim()||draft.contacts.some(c=>!c.name.trim())){announce('Enter a company name and a name for each contact before saving.');return;}
  const customer={...draft,name:draft.name.trim(),phone:draft.phone.trim(),address:draft.address.trim(),contacts:draft.contacts.map(c=>({...c,name:c.name.trim(),phone:c.phone.trim(),email:c.email.trim()}))};
  commit({type:'upsert_customer',customer});
 };
 function render(){
  $('customerModeNotice').textContent=linkedSource?(linkedSource.singleCompany?linkedSource.label:'Today’s customer list · '+linkedSource.label):practiceMode?'Practice template · Five fictional companies. Practice saves stay in this tab until reload; they do not change your saved customer records.':'Your saved companies · Record actual activity only.';
  $('customerNewCompanyControls').hidden=!!linkedSource;
  $('customerRecordActivity').hidden=!!linkedSource?.readOnly;
  const directions=$('customerDirections');
  const company=doc?.customers.find(c=>c.id===selected);
  const address=linkedSource?.directionsAddress||(!practiceMode&&company?.address?.split('\n').find(line=>line.trim()));
  directions.hidden=!address;
  if(directions.hidden)directions.removeAttribute('href');
  else directions.href='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(address);
  $('customerModeSwitch').textContent=practiceMode?'Show my saved companies':'Show five-company practice template';
  const list=$('customerDemoList');list.replaceChildren();
  for(const c of doc?.customers||[]){const b=document.createElement('button');b.type='button';b.textContent=c.name;b.setAttribute('aria-pressed',String(c.id===selected));b.disabled=busy;b.onclick=()=>{remember();selected=c.id;render();};list.append(b);}
  const c=doc?.customers.find(c=>c.id===selected);
  $('customerDemoName').textContent=c?.name||'Add or select a customer';
  const history=(doc?.activities||[]).filter(a=>a.customerId===selected).sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  $('customerDemoVisited').textContent=history.some(a=>a.outcome==='met')?'In-person meeting recorded':'No in-person meeting recorded';
  renderCompany(c);
  fields.contactId.replaceChildren(new Option('No specific contact',''));
  for(const person of c?.contacts||[])fields.contactId.add(new Option(person.name,person.id));
  $('customerDemoHistory').textContent=history.map(a=>`${new Date(a.occurredAt).toLocaleString()} · ${labels[a.outcome]}${a.contactName?' · '+a.contactName:''}: ${a.notes}${a.nextAction?' · '+followUpText(a):''}`).join('\n')||'No recorded contact.';
  const last=history[0];
  $('customerLastTitle').textContent='Last contact';
  $('customerLastSummary').textContent=last?`${new Date(last.occurredAt).toLocaleString()} · ${labels[last.outcome]}${last.contactName?' · '+last.contactName:''}\n${last.notes||'No notes recorded.'}${last.nextAction?'\n'+followUpText(last):''}`:'';
  $('customerLastSummary').hidden=!last;
  for(const [k,el] of Object.entries(fields))el.value=drafts.get(selected)?.[k]||'';
  updateNext();controls();
 }
 async function request(method,body){
  if(linkedSource)return linkedSource.request(method,body);
  if(practiceMode){
   if(method==='POST'){
    if(body.expectedRevision!==practiceDoc.revision)throw new Error('CONFLICT');
    const next=structuredClone(practiceDoc);
    if(body.type==='upsert_customer'){const i=next.customers.findIndex(c=>c.id===body.customer.id);if(i<0)next.customers.push(body.customer);else next.customers[i]=body.customer;}
    else if(body.type==='record_activity'){if(!next.activities.some(a=>a.id===body.activity.id))next.activities.push(body.activity);}
    else if(body.type==='update_followup'){const a=next.activities.find(a=>a.id===body.followUp.id);if(!a)throw new Error('UNAVAILABLE');Object.assign(a,body.followUp.operation==='complete'?{followUpCompletedAt:body.followUp.at}:{remindAt:body.followUp.at});}
    else throw new Error('UNAVAILABLE');
    next.revision++;practiceDoc=next;
   }
   return structuredClone(practiceDoc);
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const r=await fetch('/api/customer-activity',{method,credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal});
   const data=await r.json();
   if(r.status===401){const error=new Error('SESSION');throw error;}
   if(r.status===409)throw new Error('CONFLICT');
   if(!r.ok||data.ok!==true||!data.document||!Array.isArray(data.document.customers)||!Array.isArray(data.document.activities)||!Number.isSafeInteger(data.document.revision))throw new Error('UNAVAILABLE');
   return data.document;
  }finally{clearTimeout(timer);}
 }
 function clearPrivate(){doc=null;selected=null;pending=null;drafts.clear();companyDrafts.clear();companyDirty.clear();$('customerNewName').value='';for(const el of Object.values(fields))el.value='';render();}
 async function load(){
  remember();const ticket=++epoch;busy=true;controls();announce('Loading saved records…');
  try{const fresh=await request('GET');if(ticket!==epoch)return;doc=fresh;remindersStale=false;reminderSessionExpired=false;
   const confirmed=pending&&(pending.type==='update_followup'?doc.activities.some(a=>a.id===pending.followUp.id&&(pending.followUp.operation==='complete'?!!a.followUpCompletedAt:a.remindAt===pending.followUp.at)):pending.type==='record_activity'?doc.activities.some(a=>a.id===pending.activity.id):doc.customers.some(c=>c.id===pending.customer.id&&Object.entries(pending.customer).every(([key,value])=>JSON.stringify(c[key])===JSON.stringify(value))));
   if(confirmed){if(pending.type==='record_activity')drafts.delete(pending.activity.customerId);else if(pending.type==='upsert_customer'){companyDrafts.delete(pending.customer.id);companyDirty.delete(pending.customer.id);$('customerNewName').value='';}pending=null;}
   // If no matching ID is present, allow an explicit retry using this fresh revision.
   uncertain=false;selected=doc.customers.some(c=>c.id===selected)?selected:doc.customers[0]?.id||null;
   announce(confirmed?'Previous save confirmed.':'');
  }catch(error){if(ticket!==epoch)return;uncertain=true;remindersStale=true;if(error.message==='SESSION'){reminderSessionExpired=true;clearPrivate();announce('Session expired. Sign in again to load your records.');}else announce('Could not load records. Existing notes are retained; reload before saving.');}
  finally{if(ticket===epoch){busy=false;render();if(!overlay.hidden&&document.activeElement===document.body)reload.focus();}}
 }
 async function commit(command){
  if(busy||uncertain||!doc)return;
  busy=true;controls();if(!savingAll)remember();announce('Saving…');
  pending=command;
  try{doc=await request('POST',{...command,expectedRevision:doc.revision});
   if(command.type==='record_activity'){drafts.delete(command.activity.customerId);if(selected===command.activity.customerId)for(const el of Object.values(fields))el.value='';}
   else if(command.type==='upsert_customer'){if(!savingAll)selected=command.customer.id;companyDrafts.delete(command.customer.id);companyDirty.delete(command.customer.id);if($('customerNewName').value.trim()===command.customer.name)$('customerNewName').value='';$('companyEditor').open=true;}
   pending=null;remindersStale=false;announce(practiceMode?'Practice changes saved in this tab only.':'Saved.');
   return true;
  }catch(error){uncertain=true;
   if(error.message==='SESSION'){reminderSessionExpired=true;clearPrivate();announce('Session expired. Sign in again.');}
   else announce(error.message==='CONFLICT'?'Another update arrived. Your notes are retained. Check save status, review, then save again.':'Save not confirmed. Your notes are retained. Check save status before retrying.');
   return false;
  }finally{busy=false;render();if(command.type==='update_followup'&&overlay.hidden)$('customerReminderSummary').focus();}
 }
 function close(retain=true){if(retain)remember();$('customerClosePrompt').hidden=true;overlay.hidden=true;if(returnFocus?.isConnected)returnFocus.focus();}
 $('customerModeSwitch').onclick=()=>{
  if(busy||savingAll||uncertain)return;
  if(hasChanges()){announce('Save your changes before switching between practice and saved companies.');requestClose();return;}
  clearPrivate();reminderSessionExpired=false;practiceMode=!practiceMode;
  try{sessionStorage.setItem('jamesCustomerMode',practiceMode?'practice':'saved');}catch{}
  load();
 };
 openButton.onclick=()=>page('customer-database');
 window.jamesOpenLinkedCustomerActivity=async source=>{
  if(busy||savingAll||uncertain||hasChanges()){announce('Save or reconcile the current activity before changing lists.');overlay.hidden=false;return false;}
  if(linkedSource&&linkedSource.key!==source.key)releaseLinked();
  if(!linkedSource){legacyBefore={doc,selected,practiceMode};clearPrivate();linkedSource=source;practiceMode=false;}
  returnFocus=document.activeElement;overlay.hidden=false;closeButton.focus();await load();
  if(source.singleCompany)$('companyEditor').open=true;
  return !!doc&&!uncertain;
 };
 function releaseLinked(){
  if(!linkedSource)return;const previous=legacyBefore;linkedSource=null;legacyBefore=null;clearPrivate();if(previous){doc=previous.doc;selected=previous.selected;practiceMode=previous.practiceMode;}render();
 }
 window.jamesClearLinkedCustomerActivity=()=>{if(linkedSource){++epoch;linkedSource=null;legacyBefore=null;clearPrivate();overlay.hidden=true;}};
 window.addEventListener('james-conversation-ended',window.jamesClearLinkedCustomerActivity);
 window.addEventListener('pagehide',window.jamesClearLinkedCustomerActivity);
 $('customerViewHistory').onclick=event=>{event.preventDefault();const history=$('customerHistoryDetails');history.open=!history.open;if(history.open){$('customerDemoHistory').setAttribute('tabindex','-1');$('customerDemoHistory').focus();}};
 function hasActivity(d){return d&&Object.values(d).some(v=>v.trim());}
 function hasChanges(){remember();return companyDirty.size>0||[...drafts.values()].some(hasActivity)||$('customerNewName').value.trim()||pending;}
 function requestClose(){
  if(busy||savingAll)return;
  if(!hasChanges()){close();return;}
  $('customerClosePrompt').hidden=false;$('customerCloseSave').disabled=uncertain;$('customerCloseTitle').textContent=uncertain?'Check save status before closing':'Save changes before closing?';
  (uncertain?reload:$('customerCloseSave')).focus();
 }
 closeButton.onclick=requestClose;reload.onclick=load;
 $('customerExitDraft').onclick=()=>{if(busy||savingAll)return;close();$('customerSaveNotice').textContent=uncertain||pending?'Draft retained in this tab. Previous save is unconfirmed; check status when you return.':'Draft kept in this tab until reload. Not saved to customer history.';};
 $('customerKeepEditing').onclick=()=>{$('customerClosePrompt').hidden=true;closeButton.focus();};
 $('customerCloseSave').onclick=()=>saveAll();
 for(const el of Object.values(fields))el.addEventListener('input',()=>{remember();updateNext();announce('Unsaved activity.');});
 add.onclick=()=>{const name=$('customerNewName').value.trim();if(!name){announce('Enter a company name.');return;}const customer=pending?.type==='upsert_customer'&&pending.customer.name===name?pending.customer:{id:uuid(),name,source:'manual'};commit({type:'upsert_customer',customer});};
 async function saveAll(){
  if(busy||savingAll||uncertain||!doc)return;
  remember();const queue=[];
  // Validate every draft before writing any part of a multi-company save.
  for(const id of companyDirty){
   const draft=companyDrafts.get(id);
   if(!draft?.name.trim()||draft.contacts.some(c=>!c.name.trim())){announce('Enter a company name and a name for each contact before saving.');$('customerClosePrompt').hidden=true;selected=id;render();$('companyEditor').open=true;$('companyName').focus();return;}
   queue.push({type:'upsert_customer',customer:{...draft,name:draft.name.trim(),phone:draft.phone.trim(),address:draft.address.trim(),contacts:draft.contacts.map(c=>({...c,name:c.name.trim(),phone:c.phone.trim(),email:c.email.trim()}))}});
  }
  const newName=$('customerNewName').value.trim();
  if(newName)queue.push({type:'upsert_customer',customer:pending?.type==='upsert_customer'&&pending.customer.name===newName?pending.customer:{id:uuid(),name:newName,source:'manual'}});
  for(const [id,d] of drafts){
   if(!hasActivity(d))continue;
   const date=new Date(d.when);
   let message=!d.outcome||!d.when?'Choose what happened and when before saving. Your draft has not been saved.':!Number.isFinite(+date)||+date>Date.now()?'Enter a valid time that is not in the future.':d.outcome==='other'&&!d.notes.trim()?'Explain what happened in the notes.':'';
   if(!message&&!d.nextKind)message='Choose a next step or No follow-up needed before saving.';
   if(!message&&d.nextKind!=='No follow-up needed'&&(!d.nextDetails.trim()||!d.nextWhen||!Number.isFinite(+new Date(d.nextWhen))||+new Date(d.nextWhen)<=Date.now()))message='Describe your next step and choose a future date and time before saving.';
   if(message){$('customerClosePrompt').hidden=true;selected=id;render();announce(message);(!d.outcome?fields.outcome:!d.when?fields.when:!d.nextKind?fields.nextKind:d.nextKind!=='No follow-up needed'&&!d.nextDetails.trim()?fields.nextDetails:d.nextKind!=='No follow-up needed'?fields.nextWhen:fields.notes).focus();return;}
   const customer=queue.find(c=>c.type==='upsert_customer'&&c.customer.id===id)?.customer||doc.customers.find(c=>c.id===id);
   const person=customer?.contacts?.find(c=>c.id===d.contactId);
   queue.push({type:'record_activity',activity:{id:pending?.type==='record_activity'&&pending.activity.customerId===id?pending.activity.id:uuid(),customerId:id,...(person?{contactId:person.id,contactName:person.name}:{}),occurredAt:date.toISOString(),outcome:d.outcome,notes:d.notes,nextAction:d.nextKind,...(d.nextKind!=='No follow-up needed'?{nextActionDetails:d.nextDetails.trim(),nextActionAt:new Date(d.nextWhen).toISOString()}:{}),initiatedBy:'typed'}});
  }
  savingAll=true;save.disabled=true;closeButton.disabled=true;$('customerCloseSave').disabled=true;$('customerKeepEditing').disabled=true;
  try{
   for(const command of queue){if(!await commit(command))return;}
   announce(queue.length?'Changes saved.':'No changes to save.');$('customerSaveNotice').textContent=queue.length?(practiceMode?'Practice changes saved in this tab only.':'Customer changes saved.'):'';close(false);if(linkedSource){const done=linkedSource.onSaved;releaseLinked();done?.();}
  }finally{savingAll=false;closeButton.disabled=false;$('customerCloseSave').disabled=uncertain;$('customerKeepEditing').disabled=false;controls();}
 }
 save.onclick=saveAll;
 overlay.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();if(!$('customerClosePrompt').hidden){$('customerKeepEditing').click();}else requestClose();return;}
  if(event.key!=='Tab')return;
  const els=[...overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length),first=els[0],last=els.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 });
 load();
 setInterval(()=>{if(document.visibilityState!=='visible')return;renderReminders();},10000);
 setInterval(()=>{if(document.visibilityState==='visible'&&overlay.hidden&&!$('customerReminders').contains(document.activeElement)&&!busy&&!savingAll&&!uncertain&&!hasChanges())load();},60000);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&overlay.hidden&&!$('customerReminders').contains(document.activeElement)&&!busy&&!savingAll&&!uncertain&&!hasChanges())load();});
}
document.addEventListener('DOMContentLoaded',initCustomerActivity,{once:true});

document.addEventListener('DOMContentLoaded',()=>{
 const form=document.getElementById('outlookComposeForm');
 if(!form)return;
 const panel=document.getElementById('outlookComposeReview');
 const status=document.getElementById('outlookComposeStatus');
 const reconnect=document.getElementById('outlookComposeReconnect');
 const library=document.getElementById('voiceAttachmentLibrary');
 const selection=document.getElementById('voiceAttachmentSelection');
 let voiceFiles=[];
 let attachmentRequested=false;
 function showVoiceFiles(){
  selection.replaceChildren();
  for(const file of voiceFiles){
   const remove=document.createElement('button');
   remove.type='button';
   remove.textContent='Remove '+file.name;
   remove.onclick=()=>{voiceFiles=voiceFiles.filter(item=>item!==file);showVoiceFiles();};
   selection.append(remove);
  }
 }
 const filesStatus=document.getElementById('voiceAttachmentLibraryStatus');
 const savedList=document.getElementById('savedJamesFiles');
 const searchFiles=document.getElementById('searchJamesFiles');
 const saveFiles=document.getElementById('saveJamesFiles');
 let savedFiles=[];
 async function filesRequest({id, method='GET', payload}={}){
  const response=await fetch('/api/james/files'+(id?'?id='+encodeURIComponent(id):''),{
   method,cache:'no-store',
   ...(payload?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})
  });
  if(response.status===204)return;
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  return result;
 }
 async function saveAccountFile(file){
  const content=await new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onload=()=>resolve(reader.result.split(',')[1]);
   reader.onerror=()=>reject(reader.error);
   reader.readAsDataURL(file);
  });
  await filesRequest({method:'POST',payload:{name:file.name,type:file.type,lastModified:file.lastModified,content}});
 }
 async function readAccountFile(id){
  const {file}=await filesRequest({id});
  const bytes=Uint8Array.from(atob(file.content), character=>character.charCodeAt(0));
  return new File([bytes],file.name,{type:file.type,lastModified:file.lastModified});
 }
 function renderSavedFiles(){
  savedList.replaceChildren();
  const query=searchFiles.value.trim().toLowerCase();
  for(const file of savedFiles.filter(entry=>entry.name.toLowerCase().includes(query))){
   const {id}=file;
   const row=document.createElement('p');
   const name=document.createElement('span');
   name.textContent=file.name+' · '+Math.ceil(file.size/1024)+' KB ';
   const remove=document.createElement('button');
   remove.type='button';remove.textContent='Remove';
   remove.setAttribute('aria-label','Remove saved file '+file.name);
   remove.onclick=async()=>{
    if(!window.confirm('Remove '+file.name+' from James Files?'))return;
    try{
     await filesRequest({id,method:'DELETE'});
     await refreshSavedFiles();
    }catch{filesStatus.textContent='Could not remove the saved file.';}
   };
   row.append(name,remove);savedList.append(row);
  }
 }
 async function refreshSavedFiles(){
  ({files:savedFiles}=await filesRequest());
  renderSavedFiles();
 }
 function loadSavedFiles(){
  return refreshSavedFiles().then(()=>true).catch(()=>{
   filesStatus.textContent='James Files is unavailable. Open Files again to retry.';
   return false;
  });
 }
 document.addEventListener('james:files-opened',loadSavedFiles);
 if(document.getElementById('files')?.classList.contains('active'))loadSavedFiles();
 searchFiles.oninput=renderSavedFiles;
 saveFiles.onclick=async()=>{
  const selected=Array.from(library.files);
  if(!selected.length){filesStatus.textContent='Choose files first.';return;}
  if(selected.some(file=>file.size>2*1024*1024)){filesStatus.textContent='Each saved file must be 2 MB or smaller.';return;}
  saveFiles.disabled=true;
  const saved=[];
  try{
   for(const file of selected){
    await saveAccountFile(file);
    saved.push(file.name);
   }
   library.value='';
   if(await loadSavedFiles())filesStatus.textContent='Saved to your James account: '+saved.join(', ')+'.';
  }catch(error){
   await loadSavedFiles();
   const prefix=saved.length?'Saved '+saved.join(', ')+'. ':'';
   filesStatus.textContent=prefix+(error.message==='FILES_LIMIT_REACHED'?'Files is full (20 files). Remove a file before saving more.':'Could not save '+selected[saved.length].name+'. Try again.');
  }
  finally{saveFiles.disabled=false;}
 };
 library.onchange=()=>{
  document.getElementById('voiceAttachmentLibraryStatus').textContent=
   Array.from(library.files,file=>file.name).join(', ')||'No files selected.';
 };
 document.addEventListener('james:review-outlook-draft',async event=>{
  const attachmentRequest=event.detail.text.match(/\b(?:attach(?:ing)?|include|add)\b[\s:,-]+([\s\S]+)/i)?.[1]||'';
  const filesAvailable=!attachmentRequest||await loadSavedFiles();
  if(draftId||form.hidden||form.querySelector('button[type=submit]').disabled){
   status.textContent='Finish reviewing the current draft before starting another.';
  }else{
   const {text,reply}=event.detail;
   const self=/\bto\s+(?:myself|me)\b/i.test(text);
   const recipient=text.match(/\bto\s+([^\s,;<>]+@[^\s,;<>]+\.[a-z]{2,})(?=[\s,;.!?]|$)/i)?.[1];
   const subject=reply.match(/^\s*(?:\*\*)?Subject(?:\*\*)?\s*:(?:\*\*)?[ \t]*([^\r\n]+)/im);
   const body=subject?reply.slice(subject.index+subject[0].length):reply;
   form.elements.to.value=self?'allproactive@hotmail.com':recipient||'';
   form.elements.subject.value=subject?.[1].trim()||'';
   form.elements.message.value=body.replace(/^\s*(?:\*\*)?(?:To|From)(?:\*\*)?\s*:(?:\*\*)?[^\r\n]*/gim,'').trim();
   form.elements.files.value='';
   attachmentRequested=Boolean(attachmentRequest);
   const digits=['zero','one','two','three','four','five','six','seven','eight','nine'];
   const normalized=value=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ')
    .replace(/\bdot\s+/g,'').replace(/\bp\s+d\s+f\b/g,'pdf')
    .replace(/([a-z])(?=\d)/g,'$1 ').replace(/(\d)(?=[a-z])/g,'$1 ')
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine)\b/g,word=>String(digits.indexOf(word))).trim();
   const requested=' '+normalized(attachmentRequest)+' ';
   const available=[...new Map([...(filesAvailable?savedFiles:[]),...library.files]
    .map(file=>[JSON.stringify([file.name,file.size,file.lastModified]),file])).values()];
   const stem=file=>normalized(file.name.replace(/\.[a-z0-9]+$/i,''));
   const matches=available.filter(file=>{
    const full=normalized(file.name), short=stem(file);
    if(requested.includes(' '+full+' '))return available.filter(item=>normalized(item.name)===full).length===1;
    return short && requested.includes(' '+short+' ') && available.filter(item=>stem(item)===short).length===1;
   });
   const prepare=form.querySelector('button[type=submit]');
   prepare.disabled=true;
   let failedFile;
   try{
    voiceFiles=[];
    for(const file of matches){
     failedFile=file.name;
     voiceFiles.push(file.id?await readAccountFile(file.id):file);
     failedFile=undefined;
    }
   }catch{voiceFiles=[];}
   finally{prepare.disabled=false;}
   showVoiceFiles();
   const heard=' James heard: “'+text+'”. Files available: '+(available.map(file=>file.name).join(', ')||'none')+'.';
   status.textContent=!filesAvailable&&!matches.length ? 'Could not check James Files. Choose the file here or try again.' : failedFile ? 'Could not load ' + failedFile + '. Choose the file here or try again.' : attachmentRequest
    ? (voiceFiles.length ? 'Matched '+voiceFiles.map(file=>file.name).join(', ')+'. Check the files before preparing for review.' : 'No attachment matched your request. Select the file in Files first, or use Choose Files here.'+heard)
    : 'Check the recipient before preparing for review.';
  }
  page('personalMail');
  document.getElementById('outlookCompose').open=true;
 });

 const request=async payload=>{
  reconnect.hidden=true;
  const response=await fetch('/api/microsoft/compose',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  const result=await response.json();
  if(response.ok)return result;
  if(result.error==='MAIL_PERMISSION_REQUIRED'||result.error==='PERSONAL_MAILBOX_REQUIRED'){
   reconnect.hidden=false;
   throw Error('Connect allproactive@hotmail.com with draft and send permissions.');
  }
  if(result.missing?.length)throw Error('Draft saved in Outlook. Missing attachments: '+(result.issues || result.missing).join(', '));
  if(result.error==='DRAFT_REVIEW_REQUIRED')throw Error('The draft changed. Prepare it for review again.');
  throw Error('Outlook could not complete the request.');
 };
 const fileData=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onerror=()=>reject(Error('Could not read '+file.name));
  reader.onload=()=>resolve({name:file.name,contentType:file.type||'application/octet-stream',contentBytes:reader.result.split(',')[1]});
  reader.readAsDataURL(file);
 });
 let draftId;
 const composer=document.getElementById('outlookCompose');
 const drafts=document.getElementById('outlookDrafts');
 const draftList=document.getElementById('outlookDraftList');
 function resetComposer(){
  draftId=undefined;
  form.reset();form.hidden=false;
  attachmentRequested=false;voiceFiles=[];showVoiceFiles();
  panel.replaceChildren();panel.hidden=true;composer.open=false;
 }
 async function loadDrafts(){
  draftList.textContent='Loading Outlook drafts…';
  try{
   const {drafts:items}=await request({action:'drafts'});
   draftList.replaceChildren();
   for(const item of items){
    const button=document.createElement('button');
    button.type='button';button.textContent=item.subject||'(No subject)';
    button.onclick=async()=>{
     if(draftId||form.elements.to.value||form.elements.subject.value||form.elements.message.value||form.elements.files.files.length||voiceFiles.length){
      composer.open=true;status.textContent='Save and close or discard the current draft first.';return;
     }
     try{
      const {id,review}=await request({action:'open',id:item.id});
      draftId=id;
      form.elements.to.value=review.to.join(', ');
      form.elements.subject.value=review.subject;
      form.elements.message.value=review.message;
      status.textContent='Saved attachments: '+(review.attachments.map(file=>file.name).join(', ')||'None');
      composer.open=true;
     }catch(error){draftList.textContent=error.message;}
    };
    draftList.append(button,document.createElement('br'));
   }
   if(!items.length)draftList.textContent='No saved drafts.';
  }catch(error){draftList.textContent=error.message;}
 }
 drafts.ontoggle=()=>{if(drafts.open)void loadDrafts();};
 async function discardDraft(){
  if(!window.confirm('Discard this email draft?'))return;
  try{
   if(draftId)await request({action:'discard',id:draftId});
   resetComposer();status.textContent='Draft discarded.';
   if(drafts.open)void loadDrafts();
  }catch(error){status.textContent=error.message;}
 }
 document.getElementById('outlookDiscard').onclick=discardDraft;
 form.onsubmit=async event=>{
  event.preventDefault();
  const submit=form.querySelector('button[type=submit]');
  if(submit.disabled)return;
  const mode=event.submitter?.value;
  submit.disabled=true;
  status.textContent='Preparing Outlook draft…';
  try{
   const fields=new FormData(form);
   const files=[...voiceFiles,...form.elements.files.files];
   if(attachmentRequested&&!files.length)throw Error('Add the requested attachment before preparing for review.');
   if(files.length>10||files.reduce((total,file)=>total+file.size,0)>2200000)throw Error('Choose up to 10 files totaling 2.2 MB or less.');
   const {id,review}=await request({
    action:mode?'save':'prepare',id:draftId,to:fields.get('to').split(',').map(value=>value.trim()).filter(Boolean),
    subject:fields.get('subject'),message:fields.get('message'),files:await Promise.all(files.map(fileData))
   });
   draftId=id;
   form.elements.files.value='';
   attachmentRequested=false;voiceFiles=[];showVoiceFiles();
   if(mode){
    status.textContent='Saved in Outlook Drafts.';
    if(mode==='close')resetComposer();
    if(drafts.open)void loadDrafts();
    return;
   }
   const details=document.createElement('pre');
   details.style.whiteSpace='pre-wrap';
   details.textContent=[
    'From: '+review.from,'To: '+review.to.join(', '),
    'Cc: '+review.cc.join(', '),'Bcc: '+review.bcc.join(', '),
    'Subject: '+review.subject,'',review.message,'',
    'Attachments: '+(review.attachments.map(file=>file.name).join(', ')||'None')
   ].join('\n');
   const edit=document.createElement('button');
   edit.type='button';edit.textContent='Edit';
   edit.onclick=async()=>{
    edit.disabled=true;send.disabled=true;
    try{
     await request({action:'edit',id,revision:review.revision});
     panel.replaceChildren();panel.hidden=true;form.hidden=false;
     status.textContent='Edit and prepare for review again.';
    }catch(error){status.textContent=error.message;edit.disabled=false;send.disabled=false;}
   };
   const send=document.createElement('button');
   send.type='button';send.textContent='Approve & Send';
   let action='send';
   send.onclick=async()=>{
    send.disabled=true;edit.disabled=true;
    try{
     const result=await request({action,id,revision:review.revision});
     status.textContent=result.status==='sent'?'Confirmed in Outlook Sent Items.':'Submitted to Outlook — confirmation pending';
     if(result.status==='sent'){
      resetComposer();
      return;
     }
     if(result.status==='not_submitted'){
      status.textContent='Outlook has no submission for this draft. Approve again to send.';
      action='send';send.textContent='Approve & Send';send.disabled=false;edit.disabled=false;
      return;
     }
    }catch(error){status.textContent=error.message;}
    action='status';send.textContent='Check Outlook status';send.disabled=false;
   };
   const close=document.createElement('button');
   close.type='button';close.textContent='Save and close';
   close.onclick=()=>{resetComposer();status.textContent='Saved in Outlook Drafts.';if(drafts.open)void loadDrafts();};
   const discard=document.createElement('button');
   discard.type='button';discard.textContent='Discard draft';discard.onclick=discardDraft;
   panel.replaceChildren(details,edit,send,close,discard);
   form.hidden=true;panel.hidden=false;status.textContent='Ready to review';
  }catch(error){status.textContent=error.message;}
  finally{submit.disabled=false;}
 };
});
