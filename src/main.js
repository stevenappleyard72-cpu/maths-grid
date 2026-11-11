import './style.css';
import { GRID_SIZE, ROUND_TIME, createRng, createBoard, findTargets, collapseBoard, isAdjacent, getPathSum, validatePath, scorePath, shuffleBoard } from './surgeEngine.js';
import { sound } from './audio.js';

const $ = (selector) => document.querySelector(selector);
const icons = {
  bolt: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 2 4 14h7l-1 8 10-12h-7l1-8Z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 4-3 6-6s4-6 6-6h3m-4-4 4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  hint: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 2-1 2H9s0-1.2-1-2Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h10v6a5 5 0 0 1-10 0V3Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v6m-4 1h8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};
const storage = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`sumsurge-${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`sumsurge-${key}`, JSON.stringify(value)); } catch { /* Play works without storage. */ } },
};
const modes = {
  rush: { label: 'Rush', caption: '90 seconds. Chase the high.', icon: '01' },
  zen: { label: 'Zen', caption: 'No clock. Just one more chain.', icon: '02' },
  daily: { label: 'Daily', caption: 'One seed. A fresh challenge.', icon: '03' },
};
const state = {
  mode:'rush',phase:'ready',board:[],targets:[],targetIndex:0,path:[],hint:[],rng:createRng(`${Date.now()}-${Math.random()}`),
  score:0,clears:0,longest:0,combo:1,comboUntil:0,charge:0,surgeUntil:0,time:ROUND_TIME,
  hints:3,shuffles:2,lastTick:0,drag:false,moved:false,pointerId:null,locked:false,
  muted:storage.get('muted',false),music:storage.get('music',true),records:storage.get('records',{}),
  history:storage.get('history',[]),runToken:0,focusIndex:0,
};
let feedbackTimeout, hintTimeout, animationTimer, pausedAt, returnFocus;
const dayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const recordKey = () => state.mode === 'daily' ? `daily-${state.runDay || dayKey()}` : state.mode;
const best = () => Number(state.records[recordKey()] || 0);
const target = () => state.targets[state.targetIndex]?.value || 0;
const active = () => state.phase === 'playing' && !state.locked;
const isSurge = () => state.surgeUntil > performance.now();
const formatScore = (n) => Math.round(n).toLocaleString('en-GB');

$('#app').innerHTML = `
  <div class="ambient ambient-one"></div><div class="ambient ambient-two"></div><div class="noise"></div>
  <div class="site-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="Sum Surge home"><span class="brand-mark">${icons.bolt}</span><span>SUM<span class="brand-slash">/</span>SURGE</span><small>BY MATHSGRID</small></a>
      <nav class="header-actions" aria-label="Game settings"><span class="local-badge"><i></i> A LITTLE DAILY BRAIN POWER</span><button class="text-button" id="howToBtn">How to play <span>↗</span></button><button class="icon-button" id="soundBtn" aria-label="Mute sound" aria-pressed="true">${icons.sound}</button></nav>
    </header>
    <main class="game-layout">
      <aside class="intro-panel">
        <div class="eyebrow"><span class="tiny-line"></span> THE NUMBERS ARE ONLY THE BEGINNING</div>
        <h1>Small numbers.<br>Big <span>energy.</span><span class="heading-spark">✳</span></h1>
        <p class="intro-copy">Find a connection. Make the target.<br>Get into the flow.</p>
        <div class="mode-picker" role="group" aria-label="Game mode">
          ${Object.entries(modes).map(([key,mode])=>`<button class="mode-button ${key==='rush'?'selected':''}" data-mode="${key}" aria-pressed="${key==='rush'}"><span class="mode-number">${mode.icon}</span><span class="mode-content"><strong>${mode.label}${key==='daily'?'<span class="new-dot"></span>':''}</strong><small>${mode.caption}</small></span><span class="mode-radio"></span></button>`).join('')}
        </div>
        <button class="start-button" id="startBtn"><span>Let’s play</span>${icons.arrow}</button>
        <p class="start-note" id="startNote">90 seconds · infinite possibilities</p>
        <div class="intro-bottom"><span class="mini-star">✳</span><p>A little focus. A lot of <em>“one more go.”</em></p></div>
      </aside>
      <section class="play-panel" aria-label="Sum Surge game">
        <div class="game-topline"><span class="game-label"><i></i> <span id="gameLabel">RUSH CIRCUIT</span></span><div class="game-top-actions"><span id="roundLabel">READY WHEN YOU ARE</span><button id="pauseBtn" class="icon-button small" aria-label="Pause game" disabled>${icons.pause}</button></div></div>
        <div class="scoreboard"><div class="score-stat"><span class="label">YOUR SCORE</span><strong id="score">0<span>PTS</span></strong></div><div class="clock-stat"><span class="label" id="clockLabel">TIME LEFT</span><strong id="clock">01:30</strong></div><div class="best-stat"><span class="label">PERSONAL BEST</span><strong id="best">—</strong></div></div>
        <div class="time-track"><div id="timeFill"></div></div>
        <div class="target-strip"><div><span class="label">MAKE A TARGET</span><p>Pick one. Connect your numbers.</p></div><div class="targets" id="targets" role="group" aria-label="Choose target"></div></div>
        <div class="board-stage" id="boardStage"><div class="board-glow"></div><svg class="path-lines" id="pathLines" viewBox="0 0 500 500" aria-hidden="true"><polyline id="pathLine" points=""/></svg><div class="board" id="board" role="group" aria-label="Number grid. Connect adjacent tiles, including diagonals."></div><div class="board-particles" id="particles" aria-hidden="true"></div><div class="board-flash" id="boardFlash" aria-hidden="true"></div><div class="board-callout" id="boardCallout" aria-hidden="true"></div></div>
        <div class="expression-bar" id="expressionBar"><div class="expression-content"><span class="expression-icon">${icons.bolt}</span><span id="expression">Connect tiles. Catch a little lightning.</span></div><button class="expression-clear" id="clearPathBtn" aria-label="Clear selected path" hidden>${icons.close}</button><strong id="liveSum" hidden>0</strong><button class="bank-button" id="bankBtn" hidden>Clear ${icons.arrow}</button></div>
        <div class="board-toolbar"><button class="tool-button" id="shuffleBtn">${icons.shuffle}<span>Shuffle</span><small id="shuffleCount">2</small></button><span class="toolbar-tip" id="boardTip">Drag or tap · diagonals count</span><button class="tool-button" id="hintBtn">${icons.hint}<span>Hint</span><small id="hintCount">3</small></button></div>
      </section>
      <aside class="details-panel">
        <section class="surge-card"><div class="card-top"><span class="label">THE SURGE</span><span class="surge-icon">${icons.bolt}</span></div><h2 id="surgeTitle">Find your flow.</h2><p id="surgeDescription">Every 5 clears unlocks 10 seconds of double points.</p><div class="charge-meter" id="chargeMeter">${Array.from({length:5},(_,i)=>`<span data-charge="${i}"></span>`).join('')}</div><div class="charge-footer"><span id="chargeLabel">0 / 5 CLEARS</span><strong id="comboLabel">×1</strong></div></section>
        <section class="quick-guide"><span class="label">A SIMPLE LITTLE OBSESSION</span><div class="guide-row"><span class="guide-index">1</span><p>Connect neighbouring numbers to <strong>make a target.</strong></p></div><div class="guide-row"><span class="guide-index">2</span><p><strong>Longer chains.</strong> Bigger scores. New numbers fall into place.</p></div><div class="guide-row"><span class="guide-index">3</span><p>Find a <span class="inline-charge">✦</span> charged tile for <strong>bonus points.</strong></p></div><div class="mini-demo" aria-hidden="true"><span>3</span><i>+</i><span>4</span><i>+</i><span>5</span><i>=</i><strong>12</strong></div></section>
        <section class="records-card"><div class="records-title">${icons.trophy}<span class="label">YOUR RECENT RUNS</span></div><div id="recentRuns"></div><p class="local-note">Your progress stays on this device.</p></section>
      </aside>
    </main>
    <footer class="site-footer"><span>A GAME OF CONNECTIONS <span class="footer-dot">·</span> MATHSGRID REIMAGINED</span><button class="text-button music-toggle" id="musicBtn" aria-pressed="true"><span class="equalizer"><i></i><i></i><i></i></span><span id="musicLabel">Music on</span></button><span class="footer-right">LESS SCROLLING. MORE SPARK.</span></footer>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <dialog id="gameDialog" class="game-dialog"><div id="dialogContent"></div></dialog>
`;

function prepareBoard() {
  state.board=createBoard(state.rng);state.targets=findTargets(state.board,state.rng);state.targetIndex=0;state.path=[];state.hint=[];
  renderBoard();renderTargets();updateUI();
}

function renderBoard(newIds=new Set()) {
  const hadFocus=$('#board').contains(document.activeElement);
  $('#board').innerHTML=state.board.map((tile,index)=>`<button type="button" class="tile${tile.charged?' charged':''}${newIds.has(tile.id)?' tile-new':''}" data-index="${index}" data-id="${tile.id}" tabindex="${index===state.focusIndex?0:-1}" aria-label="${tile.value}${tile.charged?', charged, bonus points':''}, row ${Math.floor(index/GRID_SIZE)+1}, column ${index%GRID_SIZE+1}" aria-pressed="false" style="--tile-delay:${Math.floor(index/GRID_SIZE)*28}ms"><span class="tile-number">${tile.value}</span>${tile.charged?'<span class="tile-charge" aria-hidden="true">✦</span>':''}<span class="tile-step" aria-hidden="true"></span></button>`).join('');
  renderPath();
  if(hadFocus)$(`[data-index="${state.focusIndex}"]`).focus();
}

function renderTargets() {
  $('#targets').innerHTML=state.targets.map((item,index)=>`<button class="target-chip${index===state.targetIndex?' selected':''}" data-target="${index}" aria-label="Target ${item.value}" aria-pressed="${index===state.targetIndex}">${item.value}<span class="target-selected-dot"></span></button>`).join('');
}

function renderPath() {
  const sum=getPathSum(state.board,state.path),matching=state.path.length>=2&&sum===target(),over=sum>target();
  $('#boardStage').classList.toggle('matching',matching);$('#expressionBar').classList.toggle('matching',matching);$('#expressionBar').classList.toggle('over',over);
  document.querySelectorAll('.tile').forEach((el,index)=>{
    const step=state.path.indexOf(index),hintStep=state.hint.indexOf(index);
    el.classList.toggle('selected',step>=0);el.classList.toggle('path-end',step===state.path.length-1&&step>=0);el.classList.toggle('hinted',hintStep>=0);
    el.classList.toggle('valid-next',state.path.length>0&&step<0&&isAdjacent(state.path.at(-1),index));el.setAttribute('aria-pressed',String(step>=0));
    el.querySelector('.tile-step').textContent=step>=0?step+1:hintStep>=0?hintStep+1:'';
  });
  const rect=$('#boardStage').getBoundingClientRect();
  $('#pathLine').setAttribute('points',state.path.map(index=>{const tile=$(`[data-index="${index}"]`).getBoundingClientRect();return `${(tile.left+tile.width/2-rect.left)/rect.width*500},${(tile.top+tile.height/2-rect.top)/rect.height*500}`;}).join(' '));
  $('#expression').textContent=state.path.length?state.path.map(index=>state.board[index].value).join(' + '):state.phase==='ready'?'Connect tiles. Catch a little lightning.':'Find your next connection.';
  $('#liveSum').hidden=!state.path.length;$('#liveSum').textContent=`= ${sum}`;$('#clearPathBtn').hidden=!state.path.length;$('#bankBtn').hidden=!matching;
  $('#boardTip').textContent=matching?'Target hit! Release to clear.':over?'A little over. Backtrack or try another route.':state.path.length?`${Math.max(0,target()-sum)} more to make ${target()}`:'Drag or tap · diagonals count';
}

function renderRecords() {
  const entries=state.history.slice(0,3);
  $('#recentRuns').innerHTML=entries.length?entries.map((run,i)=>`<div class="recent-run"><span class="recent-number">0${i+1}</span><span>${modes[run.mode]?.label||'Rush'}<small>${run.clears} clears</small></span><strong>${formatScore(run.score)}</strong></div>`).join(''):'<div class="empty-record"><strong>Fresh circuit. Clean slate.</strong><p>Your first run starts a new story.</p></div>';
}

function updateUI() {
  document.body.classList.toggle('is-playing',state.phase==='playing'||state.phase==='paused');
  $('#score').innerHTML=`${formatScore(state.score)}<span>PTS</span>`;$('#best').textContent=best()?formatScore(best()):'—';
  const seconds=Math.max(0,Math.ceil(state.time));
  $('#clock').textContent=state.mode==='zen'?'∞':`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('#clockLabel').textContent=state.mode==='zen'?'NO PRESSURE':'TIME LEFT';$('#clock').classList.toggle('urgent',seconds<=10&&state.mode!=='zen');
  $('#timeFill').style.width=`${state.mode==='zen'?100:state.time/ROUND_TIME*100}%`;$('#timeFill').classList.toggle('urgent',seconds<=10&&state.mode!=='zen');
  $('#pauseBtn').disabled=state.phase!=='playing';$('#gameLabel').textContent=`${modes[state.mode].label.toUpperCase()} CIRCUIT`;
  $('#roundLabel').textContent=state.phase==='ready'?'READY WHEN YOU ARE':`${state.clears} CLEAR${state.clears===1?'':'S'}`;
  $('#startBtn').innerHTML=state.phase==='playing'?`<span>${state.mode==='zen'?'Finish session':'Take a breather'}</span>${state.mode==='zen'?icons.arrow:icons.pause}`:`<span>${state.phase==='ended'?'One more go':'Let’s play'}</span>${icons.arrow}`;
  $('#startNote').textContent=state.mode==='zen'?'No timer · find your own rhythm':state.mode==='daily'?`Today’s circuit · ${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'Europe/London'}).format(new Date())}`:'90 seconds · +2 seconds per clear';
  $('#hintCount').textContent=state.hints;$('#shuffleCount').textContent=state.shuffles;
  $('#hintBtn').disabled=!state.hints||state.phase==='ended'||state.locked;$('#shuffleBtn').disabled=!state.shuffles||state.phase==='ended'||state.locked;
  const surge=isSurge();document.querySelectorAll('[data-charge]').forEach((el,i)=>el.classList.toggle('filled',i<state.charge||surge));document.body.classList.toggle('surging',surge);
  $('#surgeTitle').textContent=surge?'You’re electric.':state.combo>1?'Keep it connected.':'Find your flow.';
  $('#surgeDescription').textContent=surge?'Double points. Follow that feeling.':'Every 5 clears unlocks 10 seconds of double points.';
  $('#chargeLabel').textContent=surge?`${Math.ceil((state.surgeUntil-performance.now())/1000)}s OF DOUBLE POINTS`:`${state.charge} / 5 CLEARS`;
  $('#comboLabel').textContent=`×${state.combo}${surge?' ×2':''}`;$('#surgeDescription').parentElement.classList.toggle('is-surging',surge);
  $('#soundBtn').innerHTML=state.muted?icons.mute:icons.sound;$('#soundBtn').setAttribute('aria-label',state.muted?'Enable sound':'Mute sound');$('#soundBtn').setAttribute('aria-pressed',String(!state.muted));
  $('#musicBtn').setAttribute('aria-pressed',String(state.music));$('#musicLabel').textContent=state.music?'Music on':'Music off';$('#musicBtn').classList.toggle('off',!state.music||state.muted);
}

function startRun() {
  const keepBoard=state.phase==='ready'&&(state.mode!=='daily'||state.runDay===dayKey());
  closeDialog(false);clearTimeout(animationTimer);clearTimeout(hintTimeout);state.runToken++;
  if(!keepBoard){state.runDay=dayKey();state.rng=createRng(state.mode==='daily'?`sumsurge-v1-${state.runDay}`:`${Date.now()}-${Math.random()}`);}
  Object.assign(state,{phase:'playing',score:0,clears:0,longest:0,combo:1,comboUntil:0,charge:0,surgeUntil:0,time:ROUND_TIME,hints:3,shuffles:2,lastTick:performance.now(),locked:false,drag:false,pointerId:null});
  if(!keepBoard)prepareBoard();else{renderPath();updateUI();}
  sound.setIntensity(.15);sound.unlock();sound.start(state.mode);sound.play('ui');$('#boardCallout').textContent='';toast('Make a target. Start a little spark.');
}

function pickTile(index) {
  if(!active()||!Number.isInteger(index)||!state.board[index])return;
  if(state.path.at(-2)===index){state.path.pop();sound.play('undo');renderPath();return;}
  if(state.path.includes(index)||(state.path.length&&!isAdjacent(state.path.at(-1),index)))return;
  state.path.push(index);if(!state.path.every((tile,step)=>state.hint[step]===tile))state.hint=[];
  sound.play('select',{step:state.path.length-1});renderPath();
}
function clearPath(){state.path=[];state.hint=[];renderPath();}
function finishPath(fromDrag=false) {
  if(!active()||!state.path.length)return;
  if(validatePath(state.board,state.path,target())){resolveClear();return;}
  if(fromDrag&&state.path.length>1){
    sound.play('invalid');const sum=getPathSum(state.board,state.path);
    toast(sum>target()?`${sum} is a little over ${target()}. Try a shorter chain.`:`${sum} of ${target()}. You’re close — try another chain.`);
    $('#boardStage').classList.add('miss');setTimeout(()=>$('#boardStage').classList.remove('miss'),320);clearPath();
  }
}
function burst(indices) {
  const stage=$('#boardStage').getBoundingClientRect();
  indices.forEach(index=>{const rect=$(`[data-index="${index}"]`).getBoundingClientRect();for(let i=0;i<6;i++){
    const dot=document.createElement('i');dot.className='particle';dot.style.cssText=`left:${rect.left+rect.width/2-stage.left}px;top:${rect.top+rect.height/2-stage.top}px;--dx:${Math.cos(i*Math.PI/3)*70}px;--dy:${Math.sin(i*Math.PI/3)*70}px;--rotation:${i*60}deg`;
    $('#particles').append(dot);setTimeout(()=>dot.remove(),650);
  }});
}
function resolveClear() {
  if(!active()||!validatePath(state.board,state.path,target()))return;
  state.locked=true;const now=performance.now();state.combo=now<state.comboUntil?Math.min(5,state.combo+1):1;state.comboUntil=now+7000;
  const indices=[...state.path],gain=scorePath(state.board,indices,{combo:state.combo,surge:isSurge()});
  state.score+=gain;state.clears++;state.longest=Math.max(state.longest,indices.length);if(state.mode!=='zen')state.time=Math.min(ROUND_TIME,state.time+2);
  burst(indices);sound.play('clear',{combo:state.combo,length:indices.length});
  $('#boardCallout').innerHTML=`<strong>+${formatScore(gain)}</strong><span>${indices.length>=5?'BEAUTIFUL CHAIN':state.combo>=3?`${state.combo}× COMBO`:'NICE CONNECTION'}${state.mode!=='zen'?' · +2s':''}</span>`;
  $('#boardCallout').classList.remove('show');void $('#boardCallout').offsetWidth;$('#boardCallout').classList.add('show');
  indices.forEach(index=>$(`[data-index="${index}"]`).classList.add('clearing'));
  if(!isSurge()){state.charge++;if(state.charge>=5){state.charge=0;state.surgeUntil=now+10000;sound.play('surge');toast('SURGE! Double points for 10 seconds.');}}
  sound.setIntensity(isSurge()?1:Math.min(.8,state.combo/6));updateUI();const token=state.runToken;
  animationTimer=setTimeout(()=>{
    if(token!==state.runToken)return;
    const oldIds=new Set(state.board.map(t=>t.id));state.board=collapseBoard(state.board,indices,state.rng);state.targets=findTargets(state.board,state.rng);state.targetIndex=0;state.path=[];state.hint=[];state.locked=false;
    renderBoard(new Set(state.board.filter(t=>!oldIds.has(t.id)).map(t=>t.id)));renderTargets();updateUI();
  },260);
}
function toast(message){clearTimeout(feedbackTimeout);$('#toast').textContent=message;$('#toast').classList.add('visible');feedbackTimeout=setTimeout(()=>$('#toast').classList.remove('visible'),2900);}

function endRun() {
  if(state.phase!=='playing'&&state.phase!=='paused')return;
  state.phase='ended';state.runToken++;state.locked=false;state.drag=false;state.surgeUntil=0;state.path=[];clearTimeout(animationTimer);sound.stop();sound.play('end');
  const previous=best();if(state.score>previous){state.records[recordKey()]=state.score;storage.set('records',state.records);}
  if(state.clears){state.history.unshift({mode:state.mode,score:state.score,clears:state.clears});state.history=state.history.slice(0,8);storage.set('history',state.history);}
  renderBoard();updateUI();renderRecords();
  openDialog(`<span class="dialog-eyebrow">${state.score>previous&&state.score>0?'A NEW PERSONAL BEST':'CIRCUIT COMPLETE'}</span><div class="result-icon">${icons.bolt}</div><h2>${state.clears?'That was electric.':'The next spark is yours.'}</h2><p>${state.clears?'A little focus goes a long way.':'Connect at least two neighbouring tiles to make a target.'}</p><div class="result-score">${formatScore(state.score)}<span>POINTS</span></div><div class="result-stats"><span><strong>${state.clears}</strong>clears</span><span><strong>${state.longest}</strong>longest chain</span><span><strong>${formatScore(best())}</strong>personal best</span></div><button class="start-button" id="againBtn"><span>One more go</span>${icons.arrow}</button><button class="dialog-secondary" id="doneBtn">Back to the circuit</button>`,'results');
  $('#againBtn').onclick=startRun;$('#doneBtn').onclick=()=>closeDialog(false);
}
function pauseGame(reason='pause') {
  if(state.phase!=='playing')return;
  state.phase='paused';pausedAt=performance.now();state.drag=false;state.pointerId=null;sound.stop();updateUI();const changing=reason.startsWith('mode:');
  openDialog(`<span class="dialog-eyebrow">A MOMENT TO RECHARGE</span><h2>${changing?'Switch circuits?':'Take a breath.'}</h2><p>${changing?'Starting another mode will finish this run and save your score.':'Your numbers aren’t going anywhere. The clock is paused.'}</p><button class="start-button" id="resumeBtn"><span>Keep the flow going</span>${icons.arrow}</button>${changing?'<button class="dialog-secondary" id="switchBtn">Finish run & switch mode</button>':'<button class="dialog-secondary" id="finishBtn">Finish this run</button>'}`,'pause');
  $('#resumeBtn').onclick=resumeGame;if(changing)$('#switchBtn').onclick=()=>{endRun();closeDialog(false);setMode(reason.slice(5));};else $('#finishBtn').onclick=endRun;
}
function resumeGame() {
  if(state.phase!=='paused')return;const duration=performance.now()-pausedAt;
  if(state.comboUntil)state.comboUntil+=duration;if(state.surgeUntil)state.surgeUntil+=duration;
  state.phase='playing';state.lastTick=performance.now();closeDialog(false);sound.unlock();sound.start(state.mode);updateUI();
}
function openDialog(html,type) {
  const dialog=$('#gameDialog');if(!dialog.open)returnFocus=document.activeElement;
  $('#dialogContent').innerHTML=html;dialog.dataset.type=type;dialog.setAttribute('aria-label',type==='help'?'How to play Sum Surge':type==='results'?'Run results':'Game paused');if(!dialog.open)dialog.showModal();
}
function closeDialog(resume=true) {
  if($('#gameDialog').open)$('#gameDialog').close();if(resume&&state.phase==='paused'){resumeGame();return;}if(returnFocus?.isConnected)returnFocus.focus();
}
function showHelp() {
  const wasPlaying=state.phase==='playing';if(wasPlaying){state.phase='paused';pausedAt=performance.now();state.drag=false;sound.stop();updateUI();}
  openDialog(`<button class="dialog-close icon-button" id="closeHelp" aria-label="Close instructions">${icons.close}</button><span class="dialog-eyebrow">FIND A CONNECTION</span><h2>Simple sums.<br>Serious flow.</h2><div class="help-example"><span>3</span><i>+</i><span>4</span><i>+</i><span>5</span><i>=</i><strong>12</strong></div><ol class="help-list"><li><strong>Pick a target.</strong> Choose any of the three numbers above the grid. Each has a solution.</li><li><strong>Connect to collect.</strong> Drag through neighbouring tiles, including diagonals, to add them up. Use at least two tiles. Release on the target to clear. You can also tap tiles one at a time.</li><li><strong>Build the momentum.</strong> Longer chains and ✦ charged tiles earn more points. Clear again within 7 seconds to grow your combo up to ×5. Five clears trigger a 10-second double-points surge.</li></ol><p class="help-footnote">Backtrack one tile to undo. Escape clears a path. Use arrow keys and Space to select tiles. Each clear adds 2 seconds in Rush and Daily; Zen has no timer. Hints and shuffles reset your combo. Daily uses the same starting seed and refill sequence for everyone today.</p><button class="start-button" id="helpDone"><span>${wasPlaying?'Back to the flow':'Got it. Let’s connect.'}</span>${icons.arrow}</button>`,'help');
  $('#closeHelp').onclick=()=>closeDialog();$('#helpDone').onclick=()=>closeDialog();
}
function setMode(mode) {
  if(!modes[mode])return;
  Object.assign(state,{mode,phase:'ready',score:0,clears:0,combo:1,charge:0,surgeUntil:0,time:ROUND_TIME,hints:3,shuffles:2,locked:false});state.runToken++;
  state.runDay=dayKey();state.rng=createRng(mode==='daily'?`sumsurge-v1-${state.runDay}`:`${Date.now()}-${Math.random()}`);clearTimeout(animationTimer);sound.stop();
  document.querySelectorAll('[data-mode]').forEach(el=>{el.classList.toggle('selected',el.dataset.mode===mode);el.setAttribute('aria-pressed',String(el.dataset.mode===mode));});prepareBoard();$('#boardCallout').textContent='';
}

$('#board').addEventListener('pointerdown',event=>{
  const tile=event.target.closest('[data-index]');if(!tile||event.button!==0||state.pointerId!==null||state.locked)return;
  if(state.phase==='ready'||state.phase==='ended')startRun();if(!active())return;
  event.preventDefault();sound.unlock();state.drag=true;state.moved=false;state.pointerId=event.pointerId;$('#board').setPointerCapture(event.pointerId);state.focusIndex=Number(tile.dataset.index);
  const index=Number(tile.dataset.index);if(state.path.length&&!isAdjacent(state.path.at(-1),index)&&!state.path.includes(index))clearPath();pickTile(index);
});
$('#board').addEventListener('pointermove',event=>{
  if(!state.drag||!active()||event.pointerId!==state.pointerId)return;
  const tile=document.elementFromPoint(event.clientX,event.clientY)?.closest('#board [data-index]');
  if(tile&&Number(tile.dataset.index)!==state.path.at(-1)){const previous=state.path.join(',');pickTile(Number(tile.dataset.index));if(previous!==state.path.join(','))state.moved=true;}
});
$('#board').addEventListener('pointerup',event=>{if(event.pointerId!==state.pointerId)return;state.drag=false;state.pointerId=null;if($('#board').hasPointerCapture(event.pointerId))$('#board').releasePointerCapture(event.pointerId);finishPath(state.moved);});
$('#board').addEventListener('pointercancel',()=>{state.drag=false;state.pointerId=null;clearPath();});
$('#board').addEventListener('lostpointercapture',()=>{state.drag=false;state.pointerId=null;});
$('#board').addEventListener('click',event=>{if(event.detail!==0)return;const tile=event.target.closest('[data-index]');if(!tile)return;if(state.phase==='ready'||state.phase==='ended')startRun();pickTile(Number(tile.dataset.index));finishPath();});
$('#board').addEventListener('keydown',event=>{
  const index=Number(event.target.closest('[data-index]')?.dataset.index);if(!Number.isInteger(index))return;const row=Math.floor(index/GRID_SIZE),col=index%GRID_SIZE;
  const next={ArrowLeft:row*GRID_SIZE+Math.max(0,col-1),ArrowRight:row*GRID_SIZE+Math.min(GRID_SIZE-1,col+1),ArrowUp:Math.max(0,row-1)*GRID_SIZE+col,ArrowDown:Math.min(GRID_SIZE-1,row+1)*GRID_SIZE+col}[event.key];
  if(next!==undefined){event.preventDefault();state.focusIndex=next;document.querySelectorAll('.tile').forEach(el=>el.tabIndex=Number(el.dataset.index)===next?0:-1);$(`[data-index="${next}"]`).focus();}
  if(event.key==='Backspace'){event.preventDefault();state.path.pop();renderPath();}
});
$('#targets').addEventListener('click',event=>{const button=event.target.closest('[data-target]');if(!button||state.locked||state.phase==='paused')return;state.targetIndex=Number(button.dataset.target);clearPath();renderTargets();sound.play('ui');});
$('#startBtn').onclick=()=>state.phase==='playing'?(state.mode==='zen'?endRun():pauseGame()):startRun();$('#pauseBtn').onclick=()=>pauseGame();
$('#clearPathBtn').onclick=()=>{clearPath();sound.play('undo');};$('#bankBtn').onclick=()=>finishPath();$('#howToBtn').onclick=showHelp;
$('.brand').onclick=event=>{event.preventDefault();if(state.phase==='playing')pauseGame();};
document.querySelectorAll('[data-mode]').forEach(el=>el.onclick=()=>{if(state.mode===el.dataset.mode)return;if(state.phase==='playing')pauseGame(`mode:${el.dataset.mode}`);else setMode(el.dataset.mode);});
$('#hintBtn').onclick=()=>{
  if(state.phase==='ready')startRun();if(!active()||!state.hints)return;
  state.hints--;state.combo=1;state.comboUntil=0;state.path=[];state.hint=[...state.targets[state.targetIndex].path];sound.play('hint');renderPath();updateUI();toast('Follow the numbered tiles. You’ve got this.');
  clearTimeout(hintTimeout);hintTimeout=setTimeout(()=>{state.hint=[];renderPath();},4000);
};
$('#shuffleBtn').onclick=()=>{
  if(state.phase==='ready')startRun();if(!active()||!state.shuffles)return;
  state.shuffles--;state.combo=1;state.comboUntil=0;state.path=[];state.hint=[];state.board=shuffleBoard(state.board,state.rng);state.targets=findTargets(state.board,state.rng);state.targetIndex=0;
  renderBoard(new Set(state.board.map(t=>t.id)));renderTargets();updateUI();sound.play('shuffle');toast('Fresh perspective. Same possibilities.');
};
$('#soundBtn').onclick=()=>{state.muted=!state.muted;storage.set('muted',state.muted);sound.setEnabled(!state.muted);sound.unlock();if(!state.muted&&state.phase==='playing')sound.start(state.mode);updateUI();};
$('#musicBtn').onclick=()=>{state.music=!state.music;storage.set('music',state.music);sound.unlock();sound.setMusicEnabled(state.music);if(state.phase==='playing')sound.start(state.mode);updateUI();};
$('#gameDialog').addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#gameDialog').open){if(state.path.length)clearPath();else if(state.phase==='playing')pauseGame();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.phase==='playing')pauseGame();});window.addEventListener('resize',()=>renderPath());
function tick(now) {
  if(state.phase==='playing'){
    const delta=Math.min(2,(now-state.lastTick)/1000),previous=Math.ceil(state.time);if(state.mode!=='zen')state.time=Math.max(0,state.time-delta);
    if(state.combo>1&&now>state.comboUntil){state.combo=1;sound.setIntensity(isSurge()?1:.15);updateUI();}
    if(previous!==Math.ceil(state.time)||isSurge())updateUI();
    if(state.surgeUntil&&now>=state.surgeUntil){state.surgeUntil=0;sound.setIntensity(.15);updateUI();}
    if(state.mode!=='zen'&&state.time<=10&&previous!==Math.ceil(state.time)&&state.time>0)sound.play('countdown');if(state.mode!=='zen'&&state.time<=0)endRun();
  }
  state.lastTick=now;requestAnimationFrame(tick);
}
sound.setEnabled(!state.muted);sound.setMusicEnabled(state.music);prepareBoard();renderRecords();requestAnimationFrame(tick);
if('serviceWorker' in navigator&&import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
