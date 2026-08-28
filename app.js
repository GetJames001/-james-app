const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const events = [
  ['08:30','09:00','Travel','18 min to Fort Apache Surgical','travel'],
  ['09:00','10:00','Fort Apache Surgical','Site Visit'],
  ['10:00','10:18','Travel','18 min to Advanced Surgical','travel'],
  ['10:18','11:00','Advanced Surgical','Site Visit'],
  ['11:00','13:00','Available','Open time','open'],
  ['13:00','14:00','Windmill Library','Site Visit'],
  ['14:00','14:12','Travel','12 min to Sierra Surgical','travel'],
  ['14:30','15:15','Sierra Surgical','Follow Up'],
  ['15:15','16:30','Available','Open time','open'],
  ['16:30','17:15','Allegiant Stadium','Site Visit'],
  ['17:15','18:15','Available','Open time','open'],
  ['18:15','19:00','Central Transport','Bid Review']
];
let liveEvents = [];

const mins = (t) => { const [h,m] = t.split(':').map(Number); return (h-7)*60+m; };
const pretty = (t) => { let [h,m] = t.split(':').map(Number); const s = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2,'0')} ${s}`; };
const timeToDate = (t) => { const [h,m] = t.split(':').map(Number); const d = new Date(); d.setHours(h,m,0,0); return d; };

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
  return appointments.find(e => timeToDate(e[1]) > now) || appointments[0];
}

function updateHero(){
  const appt = nextAppointment();
  const travel = events.find(e => e[4] === 'travel' && e[3].includes(appt[2])) || ['','','','18 min'];
  const drive = parseInt(travel[3],10) || 18;
  const start = timeToDate(appt[0]);
  const leave = new Date(start.getTime() - drive * 60000);
  const now = new Date();
  const diff = Math.max(0, start - now);
  const hrs = Math.floor(diff / 3600000);
  const min = Math.floor((diff % 3600000) / 60000);
  $('#nextTitle').textContent = appt[2];
  $('#nextType').textContent = `${appt[3]} · ${pretty(appt[0])}`;
  $('#countdown').textContent = hrs ? `${hrs} hr ${min} min` : `${min} min`;
  $('#leaveBy').textContent = leave.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
  $('#driveTime').textContent = `${drive} min`;
}

function buildCalendar(){
  const c = $('#calendar');
  c.innerHTML = '';
  for(let h=7; h<=19; h++){
    const r = document.createElement('div');
    r.className = 'hour';
    r.innerHTML = `<span>${h>12?h-12:h}:00 ${h>=12?'PM':'AM'}</span>`;
    c.appendChild(r);
  }
  events.forEach(e => {
    const top = mins(e[0]);
    const height = Math.max(18, mins(e[1]) - mins(e[0]));
    if(e[4] === 'open') return; // open time is intentionally represented by whitespace
    const b = document.createElement('button');
    b.className = `event ${e[4] || ''}`;
    b.style.top = `${top}px`;
    b.style.height = `${height}px`;
    if(e[4] === 'travel'){
      b.setAttribute('aria-label', e[3]);
      b.title = e[3];
      b.innerHTML = '';
    } else {
      b.innerHTML = `<b>${e[2]}</b><small>${e[3]}</small>`;
    }
    b.onclick = () => panel(e[4] === 'travel' ? 'TRAVEL' : 'APPOINTMENT', e[4] === 'travel' ? 'Route' : e[2], `<div class="panel-item"><b>${pretty(e[0])}–${pretty(e[1])}</b><span>${e[3]}</span>${e[4] === 'travel' ? '' : '<button>Call</button><button>Text</button><button>Email</button><button>Move</button><button>Notes</button><button>Files</button>'}</div>`);
    c.appendChild(b);
  });
  const now = new Date();
  const top = Math.max(0, Math.min(720, (now.getHours()-7)*60 + now.getMinutes()));
  const n = document.createElement('div');
  n.className = 'now';
  n.style.top = `${top}px`;
  c.appendChild(n);
  $('#apptList').innerHTML = events.filter(e => e[4] !== 'open' && e[4] !== 'travel').map(e => `<article><div>${pretty(e[0])}</div><div><h4>${e[2]}</h4><p>${e[3]}</p></div><button data-a="${e[2]}">Open</button></article>`).join('');
}

function page(id){
  $$('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === id));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === id));
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
  const script = text || `Good morning, Michael. I have your route starting from ${start}. Your next appointment is ${$('#nextTitle').textContent}. Leave by ${$('#leaveBy').textContent}. The Galleria bid is due tomorrow at five. Otherwise, your day looks manageable.`;
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
async function loadLiveGoogleEvents() {
  try {
    const response = await fetch('/api/google/events');
    const data = await response.json();

    if (!response.ok || !data.connected || !Array.isArray(data.events)) {
      throw new Error('Google Calendar events unavailable.');
    }

    liveEvents = data.events;
window.liveEvents = liveEvents;
    console.log('Live Google events loaded:', liveEvents.length);
  } catch (error) {
    console.error('Could not load live Google events:', error);
  }
}
document.addEventListener('DOMContentLoaded', () => {
  loadLiveGoogleEvents();
  $$('[data-start]').forEach(b => b.onclick = () => finishIntro(b.dataset.start));
  buildCalendar();
  updateHero();
  setInterval(() => { setGreeting(); updateHero(); }, 60000);
  $$('nav button').forEach(b => b.onclick = () => page(b.dataset.page));
  $$('[data-panel]').forEach(b => b.onclick = () => {
    const type = b.dataset.panel;
    const data = {
      callbacks:[['Scott Schuster','North Las Vegas Fire'],['TJ','Sunset Ridge Post Acute'],['Mission Pines','Initial call required']],
      emails:[['Ron Jeet','Generator quote confirmation'],['Maria Lopez','Galleria bid documents'],['David Kim','Central Transport proposal']],
      proposals:[['Galleria Bid','Due tomorrow at 5:00 PM'],['Central Transport','Requested by midweek']]
    }[type];
    panel(type.toUpperCase(), b.textContent.trim(), data.map(x => `<div class="panel-item"><b>${x[0]}</b><span>${x[1]}</span><button>Open</button><button>Call</button><button>Message</button></div>`).join(''));
  });
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
