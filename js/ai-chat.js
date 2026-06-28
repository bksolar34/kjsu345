/* ============================================================
   부광솔라 플로팅 AI 챗봇  v6.0  — 2026-06
   ─ LLM: EU → Mistral  /  기타 → Llama 3.x  (llm-engine.js)
   ─ Claude/Anthropic 완전 제거
   ─ 5단계 폴백: RSS → 국가포털 → 전세계 → VectorDB → KB
   ─ 입력창 항상 표시 (reopen 포함)
   ─ 자동번역: 방문자 언어로 답변
   ============================================================ */
'use strict';

window.BKSolarChat = (() => {

  /* ── 상태 ── */
  let isOpen=false, isMinimized=false, isTyping=false, initiated=false;
  let chatHistory=[], sessionData={}, inputQueue=null, reopenTimer=null;
  let currentView='home';

  const VIEW_NAMES={home:'홈',ess:'ESS 계산기',revenue:'통합수익분석',site3d:'3D 입지분석',tech:'기술 소개',contact:'문의'};
  const VIEW_ICONS={home:'fa-home',ess:'fa-battery-full',revenue:'fa-chart-line',site3d:'fa-mountain',tech:'fa-microchip',contact:'fa-envelope'};

  /* ── DOM 헬퍼 ── */
  const $=id=>document.getElementById(id);
  const msgBox  =()=>$('bkfcMessages');
  const quickBox=()=>$('bkfcQuick');
  const inputEl =()=>$('bkfcInput');

  function appendMsg(role,html){
    const box=msgBox(); if(!box)return;
    const w=document.createElement('div');
    w.className=`bkfc-msg bkfc-msg-${role}`;
    const b=document.createElement('div');
    b.className='bkfc-bubble';
    b.setAttribute('translate','yes');
    b.innerHTML=String(html).replace(/\n/g,'<br>');
    w.appendChild(b); box.appendChild(w);
    box.scrollTop=box.scrollHeight;
  }

  function showDots(){
    const box=msgBox(); if(!box||$('bkfc-typing'))return;
    const d=document.createElement('div');
    d.id='bkfc-typing'; d.className='bkfc-msg bkfc-msg-bot';
    d.innerHTML='<div class="bkfc-bubble bkfc-dots"><span></span><span></span><span></span></div>';
    box.appendChild(d); box.scrollTop=box.scrollHeight;
  }
  function hideDots(){$('bkfc-typing')?.remove();}

  function setQuickBtns(btns){
    const box=quickBox(); if(!box)return; box.innerHTML='';
    (btns||[]).forEach(b=>{
      const btn=document.createElement('button');
      btn.className='bkfc-qbtn';
      btn.innerHTML=(b.icon?`<i class="fas ${b.icon}"></i> `:'')+b.label;
      btn.onclick=()=>handleBtn(b);
      box.appendChild(btn);
    });
  }
  function clearBtns(){const b=quickBox();if(b)b.innerHTML='';}

  /* 입력창 — 항상 표시 상태 유지 */
  function showInput(hint){
    const inp=inputEl(); if(!inp)return;
    const row=inp.closest('.bkfc-input-row')||inp.parentElement;
    if(row) row.style.display='flex';
    if(hint) inp.placeholder=hint;
    setTimeout(()=>inp.focus(),80);
  }
  function ensureInputVisible(){
    // 어떤 상태에서도 입력창이 보이도록 보장
    const inp=inputEl(); if(!inp)return;
    const row=inp.closest('.bkfc-input-row')||inp.parentElement;
    if(row) row.style.display='flex';
  }
  function hideInput(){
    // 입력 대기 중에만 일시적으로 숨김 → 해제 후 즉시 복구
    const inp=inputEl(); if(!inp)return;
    inp.value='';
    // 숨기지 않고 placeholder만 초기화
    inp.placeholder='질문을 입력하세요...';
  }

  /* ── 화면 이동 ── */
  function goView(v){if(typeof switchView==='function')switchView(v);updateBadge(v);}
  function updateBadge(v){
    currentView=v;
    const n=$('bkfcScreenName'),bd=$('bkfcScreenBadge');
    const name=VIEW_NAMES[v]||v, icon=VIEW_ICONS[v]||'fa-circle';
    if(n)n.textContent=name;
    if(bd)bd.innerHTML=`<i class="fas ${icon}"></i> ${name}`;
  }

  /* ── 입력창 자동 설정 ── */
  function setField(id,val){
    const el=$(id); if(!el||val===null||val===undefined)return false;
    el.value=val;
    ['input','change'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true})));
    el.style.transition='background .3s'; el.style.background='#fffde7';
    setTimeout(()=>{el.style.background='';},1800); return true;
  }
  function setRadio(name,val){
    document.querySelectorAll(`input[name="${name}"]`).forEach(r=>{
      r.checked=r.value===val;
      if(r.checked)r.dispatchEvent(new Event('change',{bubbles:true}));
    });
  }

  /* ── waitInput ── */
  function waitInput(hint,transform){
    if(hint){const inp=inputEl();if(inp)inp.placeholder=hint;}
    ensureInputVisible();
    return new Promise(resolve=>{inputQueue={resolve,transform:transform||(v=>v)};});
  }

  /* ── 입력 텍스트 → 메뉴/흐름 라우팅 ── */
  function routeTextInput(text) {
    const t = text.trim().toLowerCase();

    // 번호 입력: 1, 2, 3, 4
    if (t === '1' || /^1[.\s]|ess|에스에스|배터리|저장장치/.test(t)) {
      appendMsg('user', text); startESS(); return true;
    }
    if (t === '2' || /^2[.\s]|수익|통합|분석|roi|투자/.test(t)) {
      appendMsg('user', text); startRevenue(); return true;
    }
    if (t === '3' || /^3[.\s]|입지|3d|지형|부지|site/.test(t)) {
      appendMsg('user', text); startSite3D(); return true;
    }
    if (t === '4' || /^4[.\s]|자유|질문|free/.test(t)) {
      clearBtns(); showInput('질문을 자유롭게 입력하세요...'); return true;
    }
    return false; // 일반 자유 질문으로 처리
  }

  /* ── ESS 흐름 중 입력창 값 자동 라우팅 ── */
  function routeESSInput(text) {
    const t = text.trim().toLowerCase();
    // 숫자 입력 → 현재 진행 중인 waitInput으로 전달됨 (inputQueue)
    // inputQueue가 없을 때만 여기서 처리
    const num = parseFloat(text);
    if (!isNaN(num) && num > 0) return num; // 숫자면 그대로 반환
    return text;
  }

  async function handleFree(text) {
    if (isTyping) return;

    // inputQueue가 없을 때 텍스트 라우팅 시도
    if (!inputQueue) {
      const routed = routeTextInput(text);
      if (routed) return;
    }

    isTyping = true;
    clearBtns();
    appendMsg('user', text);
    chatHistory.push({ role: 'user', content: text });
    showDots();

    // llm-engine.js 호출 (5단계 폴백)
    let answer='', source='kb';
    try{
      const engine = window.BKLLMEngine;
      if(engine){
        const result = await engine.getAnswer(text, chatHistory);
        answer = result.text || '';
        source = result.source || 'kb';
        // 소스 배지 표시
        if(source !== 'local_kb' && source !== 'kb'){
          const badge = source==='rss+llm'?'📡 블로그 참조':
                        source==='country_portal'?'🌐 국가 포털':
                        source==='global_search'?'🌍 전세계 검색':'📚 내장 KB';
          answer = `${badge}\n${answer}`;
        }
      }
      if(!answer) throw new Error('empty');
    }catch(e){
      console.warn('[Chat] LLM 오류:', e.message);
      answer = window.BKLLMEngine
        ? window.BKLLMEngine.localFallback(text, [], 'ko')
        : '042-584-5017로 문의해주세요.';
    }

    hideDots();
    const clean = answer.replace(/\[→[^\]]+\]/g,'').trim();
    appendMsg('bot', clean);
    chatHistory.push({role:'assistant',content:answer});

    // 화면 이동 감지
    const navMap={'[→ESS]':'ess','[→수익분석]':'revenue','[→입지분석]':'site3d','[→문의]':'contact'};
    let nav=null;
    for(const[tag,view] of Object.entries(navMap)){if(answer.includes(tag)){nav=view;break;}}

    setTimeout(()=>{
      if(nav){
        setQuickBtns([
          {label:`✅ ${VIEW_NAMES[nav]}으로 이동`,icon:VIEW_ICONS[nav],action:'goto',view:nav},
          {label:'다른 질문',icon:'fa-comment',action:'free'}
        ]);
      } else {
        setQuickBtns([
          {label:'다른 질문하기',icon:'fa-comment',action:'free'},
          {label:'메뉴로 돌아가기',icon:'fa-th',action:'main_menu'}
        ]);
      }
      ensureInputVisible(); // 버튼 표시 후에도 입력창 유지
    },300);
    isTyping=false;
  }

  /* ══════════════════════════════
     ESS 가정용 흐름
  ══════════════════════════════ */
  async function startESS(){
    appendMsg('user','1. ESS 용량 계산기');
    goView('ess');
    appendMsg('bot','ESS 계산기로 이동했습니다.\n제가 안내하면서 입력을 도와드릴까요?');
    setQuickBtns([
      {label:'예, 안내해주세요',icon:'fa-check',action:'ess_guide_yes'},
      {label:'아니오, 직접 할게요',icon:'fa-hand-pointer',action:'ess_guide_no'}
    ]);
    ensureInputVisible();
  }
  async function essGuideYes(){
    appendMsg('user','예');
    appendMsg('bot','가정용과 상업용 중 어느 쪽인가요?');
    setQuickBtns([
      {label:'🏠 가정용',icon:'fa-home',action:'ess_home'},
      {label:'🏭 상업용',icon:'fa-building',action:'ess_comm'}
    ]);
    ensureInputVisible();
  }
  async function essHome(){
    appendMsg('user','🏠 가정용');
    if(typeof essSelectType==='function')essSelectType('home');
    appendMsg('bot','가정용 ESS 안내!\n\n① ESS 단위 용량? (예: 5, 10, 20)\n→ 숫자만 입력하거나 아래 버튼을 선택하세요.');
    setQuickBtns([
      {label:'모름 → 기본 5kWh',icon:'fa-question',action:'ess_home_unit_default'},
    ]);
    showInput('ESS 용량 입력 (kWh 숫자만, 예: 10)');
    // 입력창으로 직접 입력 시 숫자 파싱 후 essHomeFlow 연동
    inputQueue = {
      resolve: (v) => { const n = parseFloat(v)||5; essHomeFlow(n); },
      transform: v => v
    };
  }
  async function essHomeFlow(unit){
    setField('homeEssBase',unit);
    appendMsg('bot',unit+'kWh ✅\n\n② 월 평균 전기 사용량(kWh)?\n(전기요금 고지서 참고 / 보통 250~400kWh)');
    setQuickBtns([{label:'모름 → 기본 360kWh',icon:'fa-question',action:'ess_home_monthly_default'}]);
    showInput('월 사용량 숫자 입력 (예: 350)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||360;essHomeMonthly(n);},transform:v=>v};
  }
  async function essHomeMonthly(val){
    setField('homeMonthlyKwh',val);
    appendMsg('bot','월 '+val+'kWh ✅\n\n③ 주거 형태?\n버튼을 선택하거나 "아파트" 또는 "주택"을 입력하세요.');
    setQuickBtns([
      {label:'🏢 아파트',icon:'fa-building',action:'ess_home_type_apt'},
      {label:'🏠 주택',icon:'fa-home',action:'ess_home_type_house'}
    ]);
    showInput('"아파트" 또는 "주택" 입력');
    inputQueue={resolve:(v)=>{
      const t=v.trim().toLowerCase();
      const type=(/아파트|apt|apartment/.test(t))?'apt':'house';
      appendMsg('user',v); essHomeType(type);
    },transform:v=>v};
  }
  async function essHomeType(type){
    setRadio('homeType',type);
    appendMsg('bot',(type==='apt'?'아파트':'주택')+' ✅\n\n④ 기존 태양광 패널이 있나요?\n버튼을 선택하거나 "예"/"아니오"를 입력하세요.');
    setQuickBtns([
      {label:'예',icon:'fa-check',action:'ess_home_panel_yes'},
      {label:'아니오',icon:'fa-times',action:'ess_home_panel_no'}
    ]);
    showInput('"예" 또는 "아니오" 입력');
    inputQueue={resolve:(v)=>{
      const yes=/예|yes|있/i.test(v.trim());
      appendMsg('user',v);
      if(yes) essHomePanelYes(); else {setRadio('hasPanel','no');appendMsg('bot','신규 설치 ✅');essHomeAddr();}
    },transform:v=>v};
  }
  async function essHomePanelYes(){
    setRadio('hasPanel','yes');
    appendMsg('bot','패널 장수를 입력해주세요.\n(숫자만 입력)');
    const cnt=await waitInput('패널 장수 (예: 8)',v=>parseInt(v)||null);
    if(cnt){setField('existingPanelCount',cnt);appendMsg('bot',cnt+'장 ✅');}
    appendMsg('bot','1장당 출력(Wp)? (기본 640Wp)\n숫자만 입력하거나 버튼을 선택하세요.');
    setQuickBtns([{label:'기본 640Wp',icon:'fa-question',action:'ess_home_panel_wp_default'}]);
    showInput('Wp 입력 (예: 375)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||640;appendMsg('user',v);essHomePanelWp(n);},transform:v=>v};
  }
  async function essHomePanelWp(wp){
    setField('existingWp',wp);
    if(wp===640){setField('existingVoltage',46.79);setField('existingCurrent',13.68);}
    appendMsg('bot',wp+'Wp ✅');
    await essHomeAddr();
  }
  async function essHomeAddr(){
    appendMsg('bot','⑤ 설치 주소를 입력해주세요.\n(NASA 일사량 자동 반영 / 주소 없으면 기본 3.8h 적용)');
    setQuickBtns([{label:'없음 → 기본 3.8h',icon:'fa-question',action:'ess_home_addr_default'}]);
    showInput('설치 주소 입력 (예: 대전광역시 서구 복수중로30)');
    inputQueue={resolve:(v)=>{appendMsg('user',v);essHomeAddrDone(v.trim());},transform:v=>v};
  }
  async function essHomeAddrDone(addr){
    if(addr&&addr!==''){
      setField('ess-home-address',addr);
      appendMsg('bot','"'+addr+'" ✅ 좌표 검색 중...');
      if(typeof geocodeAddress==='function'){await delay(400);geocodeAddress();}
    } else {setField('homeIrr',3.8);appendMsg('bot','기본 3.8h ✅');}
    appendMsg('bot','✅ ESS 계산 완료! 결과를 확인해보세요.\n추가 질문이 있으시면 아래 입력창을 이용해주세요.');
    setQuickBtns([{label:'상세 상담·견적',icon:'fa-phone',action:'consult'},{label:'메뉴 보기',icon:'fa-th',action:'main_menu'}]);
    ensureInputVisible();
    scheduleReopen(30000);
  }

  /* ESS 상업용 흐름 */
  async function essComm(){
    appendMsg('user','🏭 상업용');
    if(typeof essSelectType==='function')essSelectType('commercial');
    appendMsg('bot','상업용 ESS!\n\n① 1유닛 용량(kWh)?\n(숫자만 입력하거나 버튼 선택)');
    setQuickBtns([{label:'기본 5kWh',icon:'fa-question',action:'ess_comm_unit_default'}]);
    showInput('유닛 용량 숫자 입력 (예: 100)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||5;appendMsg('user',v);essCommUnit(n);},transform:v=>v};
  }
  async function essCommUnit(unit){
    setField('commEssBase',unit);
    appendMsg('bot',unit+'kWh ✅\n\n② 태양광 설치 용량(kW)?\n(숫자만 입력)');
    setQuickBtns([{label:'기본 100kW',icon:'fa-question',action:'ess_comm_solar_default'}]);
    showInput('태양광 용량 숫자 입력 (예: 500)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||100;appendMsg('user',v);essCommSolar(n);},transform:v=>v};
  }
  async function essCommSolar(solar){
    setField('commSolarKw',solar);
    appendMsg('bot',solar+'kW ✅\n\n③ ESS 배수?\n💡 배수 = 저장용량÷태양광용량\n예) 100kW × 2배수 = 200kWh 저장\n숫자 입력 또는 버튼 선택');
    setQuickBtns([
      {label:'1배수',icon:'fa-equals',action:'ess_comm_multi_1'},
      {label:'2배수',icon:'fa-times',action:'ess_comm_multi_2'}
    ]);
    showInput('배수 숫자 입력 (예: 1.5)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||1;appendMsg('user',v);essCommMulti(n);},transform:v=>v};
  }
  async function essCommMulti(multi){
    setField('commEssMultiplier',multi);
    appendMsg('bot',multi+'배수 ✅\n\n④ 설치 주소?\n(없으면 버튼 선택)');
    setQuickBtns([{label:'기본 3.8h',icon:'fa-question',action:'ess_comm_addr_default'}]);
    showInput('설치 주소 입력 (예: 충남 천안시)');
    inputQueue={resolve:(v)=>{appendMsg('user',v);essCommAddr(v.trim());},transform:v=>v};
  }
  async function essCommAddr(addr){
    if(addr&&addr!==''){
      setField('ess-comm-address',addr);
      appendMsg('bot','"'+addr+'" ✅ 좌표 검색 중...');
      if(typeof geocodeAddress==='function'){await delay(400);geocodeAddress();}
    } else {setField('commIrr',3.8);}
    appendMsg('bot','⑤ 방전시간(h/회)과 방전횟수(회/일)?\n예) 2h 1회 → "2 1" 형식 입력');
    setQuickBtns([{label:'기본 2h/1회',icon:'fa-check',action:'ess_comm_discharge_default'}]);
    showInput('방전시간 횟수 입력 (예: 2 1)');
    inputQueue={resolve:(v)=>{
      const parts=v.trim().split(/[\s,]+/);
      const dh=parseFloat(parts[0])||2;
      const dc=parseInt(parts[1])||1;
      appendMsg('user',v);
      essCommFinal(dh,dc);
    },transform:v=>v};
  }
  async function essCommFinal(dh,dc){
    setField('commDischargeHours',dh);setField('commCyclePerDay',dc);
    appendMsg('bot','방전 '+dh+'h/'+dc+'회 ✅\n결과를 확인해보세요!');
    setQuickBtns([{label:'상세 상담·견적',icon:'fa-phone',action:'consult'},{label:'메뉴 보기',icon:'fa-th',action:'main_menu'}]);
    ensureInputVisible();
    scheduleReopen(30000);
  }

  /* ══════════════════════════════
     통합수익분석 흐름
  ══════════════════════════════ */
  async function startRevenue(){
    appendMsg('user','2. 통합수익분석');
    goView('revenue');
    appendMsg('bot','통합수익분석 📊\n\n① 설치 부지 주소를 입력하세요.\n(NASA 일사량 자동 적용 / 없으면 버튼 선택)');
    setQuickBtns([{label:'없음 → 기본 3.8h',icon:'fa-question',action:'rev_addr_default'}]);
    showInput('설치 부지 주소 입력 (예: 대전광역시 서구)');
    inputQueue={resolve:(v)=>{appendMsg('user',v);revAddr(v.trim());},transform:v=>v};
  }
  async function revAddr(addr){
    if(addr&&addr!==''){
      setField('address-input',addr);
      appendMsg('bot','"'+addr+'" ✅ 좌표 검색 중...');
      if(typeof geocodeAddress==='function'){await delay(500);geocodeAddress();}
    } else {setField('genTime',3.8); appendMsg('bot','기본 3.8h 적용 ✅');}
    appendMsg('bot','② 표시 통화?\n"1" 또는 "원화" / "2" 또는 "달러"를 입력하거나 버튼 선택');
    setQuickBtns([
      {label:'1. 원화 ₩',icon:'fa-won-sign',action:'rev_krw'},
      {label:'2. 달러 $',icon:'fa-dollar-sign',action:'rev_usd'}
    ]);
    showInput('"1" 원화 / "2" 달러 입력');
    inputQueue={resolve:(v)=>{
      const t=v.trim().toLowerCase();
      const isUsd=/^2$|달러|dollar|usd|\$/.test(t);
      revCurrency(isUsd?'USD':'KRW');
    },transform:v=>v};
  }
  async function revCurrency(cur){
    appendMsg('user',cur==='KRW'?'1. 원화':'2. 달러');
    if(typeof changeCurrency==='function')changeCurrency(cur);
    sessionData.currency=cur;
    appendMsg('bot',(cur==='KRW'?'원화':'달러')+' ✅\n\n③ PV 설치 용량(kW)?\n(숫자만 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 3,300kW',icon:'fa-question',action:'rev_pvcap_default'}]);
    showInput('PV 용량 숫자 입력 (예: 1000)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||3300;appendMsg('user',v);revPvCap(n);},transform:v=>v};
  }
  async function revPvCap(cap){
    setField('pvCap',cap);sessionData.pvCap=cap;
    appendMsg('bot',cap+'kW ✅\n\n④ PV 투자비? (기본: '+cap+'백만원)\n(숫자만 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 '+cap+'백만원',icon:'fa-question',action:'rev_pvinvest_default',val:cap}]);
    showInput('PV 투자비 숫자 입력 (백만원, 예: '+cap+')');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||cap;appendMsg('user',v);revPvInvest(n);},transform:v=>v};
  }
  async function revPvInvest(val){
    setField('pvInvest',val);
    appendMsg('bot',val+'백만원 ✅\n\n⑤ 자기자본 비율(%)? (기본 10%)\n(숫자만 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 10%',icon:'fa-question',action:'rev_equity_default'}]);
    showInput('자기자본 비율 숫자 입력 (%, 예: 10)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||10;appendMsg('user',v+'%');revEquity(n);},transform:v=>v};
  }
  async function revEquity(rate){
    setField('pvEquityRate',rate);
    if(typeof updateFinance==='function')updateFinance();
    appendMsg('bot',rate+'% ✅\n\n⑥ BESS 설치하실 건가요?\n"예"/"아니오" 입력 또는 버튼 선택');
    setQuickBtns([
      {label:'예, 설치해요',icon:'fa-battery-full',action:'rev_bess_yes'},
      {label:'아니오',icon:'fa-times',action:'rev_bess_no'}
    ]);
    showInput('"예" 또는 "아니오" 입력');
    inputQueue={resolve:(v)=>{
      const yes=/^예|^yes|^y$/i.test(v.trim());
      appendMsg('user',v);
      if(yes) revBessYes(); else revBessNo();
    },transform:v=>v};
  }
  async function revBessYes(){
    appendMsg('user','예, BESS 설치');
    appendMsg('bot','BESS 용량(kWh)? (기본 13,200kWh)\n(숫자만 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 13,200kWh',icon:'fa-question',action:'rev_besscap_default'}]);
    showInput('BESS 용량 숫자 입력 (kWh, 예: 13200)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||13200;appendMsg('user',v);revBessCap(n);},transform:v=>v};
  }
  async function revBessCap(cap){
    setField('bessCap',cap);
    const def=Math.round(cap*0.152);
    appendMsg('bot',cap+'kWh ✅\n\nBESS 투자비? (기본 '+def+'백만원)\n(숫자만 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 '+def+'백만원',icon:'fa-question',action:'rev_bessinvest_default',val:def}]);
    showInput('BESS 투자비 숫자 입력 (백만원, 예: '+def+')');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||def;appendMsg('user',v);revBessInvest(n);},transform:v=>v};
  }
  async function revBessInvest(val){
    setField('bessInvest',val);
    appendMsg('bot',val+'백만원 ✅\n\n정부 보조금 있나요? (BESS의 30~50% 지원 가능)\n없으면 0 입력 또는 버튼 선택');
    setQuickBtns([{label:'없음 → 0',icon:'fa-times',action:'rev_subsidy_zero'}]);
    showInput('보조금 숫자 입력 (백만원, 없으면 0)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||0;appendMsg('user',v);revSubsidy(n);},transform:v=>v};
  }
  async function revSubsidy(val){
    setField('bessSubsidy',val);
    if(typeof updateFinance==='function')updateFinance();
    appendMsg('bot',val+'백만원 ✅ 순투자비 자동 계산됨');
    await revFinance();
  }
  async function revBessNo(){
    appendMsg('user','아니오');
    ['bessInvest','bessSubsidy','bessCap'].forEach(id=>setField(id,0));
    if(typeof updateFinance==='function')updateFinance();
    await revFinance();
  }
  async function revFinance(){
    appendMsg('bot','⑦ 대출금리(%)? (기본 5.5%)\n(숫자 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본값 유지',icon:'fa-check',action:'rev_loan_default'}]);
    showInput('대출금리 숫자 입력 (%, 기본 5.5)');
    inputQueue={resolve:(v)=>{
      const n=parseFloat(v);
      appendMsg('user',isNaN(n)?'기본값':v+'%');
      revLoan(isNaN(n)?null:n);
    },transform:v=>v};
  }
  async function revLoan(rate){
    if(rate!==null)setField('interestRate',rate);
    appendMsg('bot','법인세율(%)? (기본 10%)\n(숫자 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 10%',icon:'fa-question',action:'rev_tax_default'}]);
    showInput('법인세율 숫자 입력 (%, 기본 10)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||10;appendMsg('user',v+'%');revTax(n);},transform:v=>v};
  }
  async function revTax(tax){
    setField('taxRate',tax);
    appendMsg('bot',tax+'% ✅\n\n상환/사업 기간(년)? (기본 23년)\n(숫자 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 23년',icon:'fa-question',action:'rev_term_default'}]);
    showInput('기간 숫자 입력 (년, 기본 23)');
    inputQueue={resolve:(v)=>{const n=parseInt(v)||23;appendMsg('user',v+'년');revTerm(n);},transform:v=>v};
  }
  async function revTerm(term){
    setField('loanTerm',term);
    appendMsg('bot',term+'년 ✅\n\n⑧ SMP 단가? (기본 185원/kWh)\n(숫자 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 185원',icon:'fa-question',action:'rev_smp_default',val:185}]);
    showInput('SMP 단가 숫자 입력 (원/kWh, 기본 185)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||185;appendMsg('user',v);revSmp(n);},transform:v=>v};
  }
  async function revSmp(smp){
    setField('smpPrice',smp);
    appendMsg('bot',smp+'원 ✅\n\nREC 단가? (기본 75,000원/MEC, 가중치 1.0 고정)\n(숫자 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 75,000원',icon:'fa-question',action:'rev_rec_default'}]);
    showInput('REC 단가 숫자 입력 (원/MEC, 기본 75000)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||75000;appendMsg('user',v);revFinal(n);},transform:v=>v};
  }
  async function revFinal(rec){
    setField('recPrice',rec);setField('recWeight',1);setField('cdmPrice',0);
    appendMsg('bot','REC '+rec+'원 ✅ CDM 0 처리\n\n수익분석 실행 중...');
    if(typeof runProfitAnalysis==='function'){
      await delay(400);runProfitAnalysis();
      appendMsg('bot','📊 수익분석 완료!\n충전효율 98%·PCS 97%·저감률 1.95%/년 반영됨.\n추가 질문이 있으시면 입력창을 이용하세요.');
    }
    setQuickBtns([{label:'상세 상담·견적',icon:'fa-phone',action:'consult'},{label:'메뉴 보기',icon:'fa-th',action:'main_menu'}]);
    ensureInputVisible();
    scheduleReopen(30000);
  }

  /* ══════════════════════════════
     3D 입지분석 흐름
  ══════════════════════════════ */
  async function startSite3D(){
    appendMsg('user','3. 3D 입지분석');
    appendMsg('bot','3D 입지분석을 진행할까요?\n"예"/"아니오" 입력 또는 버튼 선택');
    setQuickBtns([
      {label:'예, 진행해요',icon:'fa-check',action:'site_yes'},
      {label:'아니오',icon:'fa-times',action:'close'}
    ]);
    showInput('"예" 또는 "아니오" 입력');
    inputQueue={resolve:(v)=>{
      const yes=/^예|^yes|^y$/i.test(v.trim());
      appendMsg('user',v);
      if(yes) siteStart(); else close();
    },transform:v=>v};
  }
  async function siteStart(){
    appendMsg('user','예');
    goView('site3d');
    appendMsg('bot','3D 입지분석 🗺️\n\n① 분석 대상지 주소를 입력해주세요.\n(예: 충남 천안시 서북구 쌍용동)');
    showInput('분석 대상지 주소 입력');
    inputQueue={resolve: async (addr)=>{
      if(!addr||!addr.trim())return;
      appendMsg('user',addr);
      setField('site-address-input',addr.trim());
      appendMsg('bot','"'+addr.trim()+'" ✅ 좌표 검색 중...');
      if(typeof geocodeSiteAddress==='function'){
        await delay(400); geocodeSiteAddress();
        await waitForCoords(8000,'site-lat');
      }
      await siteArea();
    },transform:v=>v};
  }
  async function waitForCoords(timeout,fieldId){
    return new Promise(resolve=>{
      let elapsed=0;
      const t=setInterval(()=>{
        elapsed+=300;
        const el=$(fieldId);
        if((el&&el.value&&parseFloat(el.value)!==0)||elapsed>=timeout){clearInterval(t);resolve();}
      },300);
    });
  }
  async function siteArea(){
    appendMsg('bot','② 설치 부지 면적(㎡)?\n(숫자만 입력 또는 버튼 선택)');
    setQuickBtns([{label:'기본 600㎡',icon:'fa-question',action:'site_area_default'}]);
    showInput('부지 면적 숫자 입력 (㎡, 예: 1000)');
    inputQueue={resolve:(v)=>{const n=parseFloat(v)||600;appendMsg('user',v+'㎡');siteAreaDone(n);},transform:v=>v};
  }
  async function siteAreaDone(area){
    setField('site-land-area',area);
    appendMsg('bot',area+'㎡ ✅\n\n③ 설치 유형?\n"1" 또는 "토지"/"영농" → 영농형\n"2" 또는 "건물"/"옥상" → 옥상형\n또는 버튼 선택');
    setQuickBtns([
      {label:'🌾 토지 위 (영농형)',icon:'fa-seedling',action:'site_type_land'},
      {label:'🏢 건물 위 (옥상형)',icon:'fa-building',action:'site_type_roof'}
    ]);
    showInput('"1" 영농형 / "2" 옥상형 입력');
    inputQueue={resolve:(v)=>{
      const t=v.trim().toLowerCase();
      const isLand=/^1$|토지|영농|land|farm/.test(t);
      appendMsg('user',v);
      siteType(isLand?'land':'roof');
    },transform:v=>v};
  }
  async function siteType(type){
    const btn=document.querySelector('.install-type-btn[data-type="'+type+'"]');
    if(btn)btn.click();else if(typeof selectInstallType==='function')selectInstallType(type);
    const label=type==='land'?'영농형(토지)':'옥상형(건물)';
    appendMsg('bot',label+' ✅\n\n분석 완료 후 확인 항목:\n• 📐 분석 범위 (반경 m)\n• ☀️ NASA 평균 일사량 (kWh/m²/일)\n• ⛰️ 지형 고도차 (m)\n• 🌑 일일 그림자 영향 (%)\n• ⚡ 실효 발전효율 (%)');
    setQuickBtns([
      {label:'3D 조작 방법',icon:'fa-cube',action:'site_3d_guide'},
      {label:'2D 포토지도 비교',icon:'fa-map',action:'site_2d_guide'},
      {label:'상세 상담',icon:'fa-phone',action:'consult'}
    ]);
    ensureInputVisible();
    scheduleReopen(30000);
  }

  /* ══════════════════════════════
     상담·견적 흐름
  ══════════════════════════════ */
  async function startConsult(){
    appendMsg('bot','상세 상담 및 견적을 도와드릴게요 😊\n\n① 성함 또는 회사명을 입력해주세요.');
    const name=await waitInput('성함 또는 회사명');
    if(!name)return;
    appendMsg('bot','감사합니다, '+name+'님 😊\n\n② 이메일 주소를 입력해주세요.');
    const email=await waitInput('이메일 주소');
    appendMsg('bot','③ 연락처(전화번호)를 입력해주세요.');
    const phone=await waitInput('연락처 (예: 010-1234-5678)');
    appendMsg('bot','④ 추가 요청사항이 있으시면 입력해주세요.\n(없으면 엔터)');
    const extra=await waitInput('추가 메시지');
    goView('contact');await delay(500);
    _fill('from_name',name);_fill('reply_to',email);_fill('phone',phone);
    const summary=buildSummary(name,email,phone);
    _fill('message',summary);
    const sb=$('ai-summary-block');
    if(sb){sb.style.display='block';_fill('ai_summary',summary);}
    if(extra&&extra.trim())_fill('extra_message',extra);
    attachYolo(name,email,phone);
    appendMsg('bot','✅ 문의 양식 자동 입력 완료!\n\n• 성함: '+name+'\n• 이메일: '+(email||'(미입력)')+'\n• 연락처: '+(phone||'(미입력)')+'\n\n"제안서 및 상담 요청" 버튼을 눌러 발송해주세요!');
    setQuickBtns([
      {label:'✉️ 지금 발송',icon:'fa-paper-plane',action:'submit_form'},
      {label:'내용 수정',icon:'fa-edit',action:'close'}
    ]);
    ensureInputVisible();
  }

  function _fill(id,value){
    if(!value)return;const el=$(id);if(!el)return;
    el.value=value;
    ['input','change'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true})));
    el.style.transition='border-color .3s,background .3s';
    el.style.borderColor='#2ecc71';el.style.background='#f0fff4';
    setTimeout(()=>{el.style.borderColor='';el.style.background='';},2500);
  }
  function buildSummary(name,email,phone){
    const lines=['[부광솔라 AI 안내 상담 요청]',
      '성명/회사: '+name,'이메일: '+email,'연락처: '+phone,'','[AI 안내 진행 내역]'];
    if(sessionData.currency)lines.push('• 통화: '+sessionData.currency);
    if(sessionData.pvCap)lines.push('• PV 용량: '+sessionData.pvCap+'kW');
    lines.push('','홈페이지 AI 안내를 통한 상담 접수');
    return lines.join('\n');
  }
  function attachYolo(name,email,phone){
    try{
      const analytics=window.SolarAnalytics;
      const yData={collected_at:new Date().toISOString(),
        visitor:{name,email,phone},
        yolo:analytics?.getReport?.(),session:analytics?.getSession?.(),
        chat:{history_len:chatHistory.length,session_data:sessionData},
        vdb_entries:window.BKLLMEngine?.VDB?.listAll?.()
      };
      ['yolo_data','session_data','ai_session_log'].forEach((id,i)=>{
        const el=$(id);if(el)el.value=JSON.stringify(
          i===0?yData:i===1?sessionData:chatHistory.slice(-20),null,2);
      });
      const ls=JSON.parse(localStorage.getItem('bk_solar_analytics')||'{"sessions":[]}');
      ls.sessions=[...(ls.sessions||[]).slice(-49),yData];
      localStorage.setItem('bk_solar_analytics',JSON.stringify(ls));
    }catch(e){console.warn('[YOLO]',e);}
  }

  /* ══════════════════════════════
     환영 & 메뉴
  ══════════════════════════════ */
  function welcome(){
    setTimeout(()=>{
      appendMsg('bot','👋 부광솔라 홈페이지 방문을 환영합니다!\n\nAI 안내 도우미입니다. 안내가 필요하신가요?');
      setQuickBtns([
        {label:'예, 안내받을게요',icon:'fa-check',action:'welcome_yes'},
        {label:'아니오, 직접 볼게요',icon:'fa-times',action:'close'}
      ]);
      ensureInputVisible();
    },500);
  }
  function showMainMenu(){
    clearBtns();
    setTimeout(()=>{
      appendMsg('bot','무엇을 안내해드릴까요? 😊');
      setQuickBtns([
        {label:'1. ESS 용량 계산기',icon:'fa-battery-full',action:'menu_ess'},
        {label:'2. 통합수익분석',icon:'fa-chart-line',action:'menu_revenue'},
        {label:'3. 3D 입지분석',icon:'fa-mountain',action:'menu_site3d'},
        {label:'💬 자유롭게 질문',icon:'fa-comment',action:'free'}
      ]);
      ensureInputVisible();
    },200);
  }

  /* ══════════════════════════════
     자동 재오픈 (입력창 항상 열림)
  ══════════════════════════════ */
  function scheduleReopen(ms){
    clearTimeout(reopenTimer);close();
    const onScroll=()=>{
      if((window.innerHeight+window.scrollY)>=document.body.scrollHeight-50){
        clearTimeout(reopenTimer);window.removeEventListener('scroll',onScroll);reopen();
      }
    };
    window.addEventListener('scroll',onScroll);
    reopenTimer=setTimeout(()=>{window.removeEventListener('scroll',onScroll);reopen();},ms);
  }
  function reopen(){
    open();
    appendMsg('bot','궁금한 점이 있으시면 말씀해주세요 😊');
    setQuickBtns([
      {label:'상세 상담·견적',icon:'fa-phone',action:'consult'},
      {label:'메뉴 보기',icon:'fa-th',action:'main_menu'},
      {label:'닫기',icon:'fa-times',action:'close'}
    ]);
    ensureInputVisible(); // ← 입력창 항상 열림
  }

  /* ══════════════════════════════
     중앙 버튼 핸들러
  ══════════════════════════════ */
  function handleBtn(b){
    switch(b.action){
      case 'close':close();return;
      case 'minimize':minimize();return;
      case 'main_menu':showMainMenu();return;
      case 'free':
        clearBtns();
        appendMsg('bot','무엇이 궁금하신가요?\n번호를 입력하거나 버튼을 선택해주세요.');
        setQuickBtns([
          {label:'1. ESS 용량 계산기',icon:'fa-battery-full',action:'menu_ess'},
          {label:'2. 통합수익분석',icon:'fa-chart-line',action:'menu_revenue'},
          {label:'3. 3D 입지분석',icon:'fa-mountain',action:'menu_site3d'},
          {label:'4. 자유롭게 질문',icon:'fa-comment',action:'free_open'}
        ]);
        ensureInputVisible();
        return;
      case 'consult':startConsult();return;
      case 'submit_form':
        document.getElementById('contact-form')?.querySelector('button[type="submit"]')?.click();return;
      case 'goto':goView(b.view);return;
      case 'welcome_yes':appendMsg('user','예, 안내받을게요');appendMsg('bot','감사합니다! 😊');showMainMenu();return;
      case 'free_open':
        clearBtns();
        showInput('질문을 자유롭게 입력하세요...');
        return;
      case 'menu_revenue':startRevenue();return;
      case 'menu_site3d':startSite3D();return;
      case 'ess_guide_yes':essGuideYes();return;
      case 'ess_guide_no':
        appendMsg('user','직접 할게요');
        appendMsg('bot','직접 이용하세요! 궁금할 때 언제든 질문해주세요 😊');
        ensureInputVisible();scheduleReopen(30000);return;
      case 'ess_home':essHome();return;
      case 'ess_comm':essComm();return;
      case 'ess_home_unit_default':appendMsg('user','기본 5kWh');essHomeFlow(5);return;
      case 'ess_home_monthly_default':appendMsg('user','기본 360kWh');essHomeMonthly(360);return;
      case 'ess_home_type_apt':appendMsg('user','아파트');essHomeType('apt');return;
      case 'ess_home_type_house':appendMsg('user','주택');essHomeType('house');return;
      case 'ess_home_panel_yes':essHomePanelYes();return;
      case 'ess_home_panel_no':setRadio('hasPanel','no');appendMsg('user','없어요');appendMsg('bot','신규 설치 ✅');essHomeAddr();return;
      case 'ess_home_panel_wp_default':essHomePanelWp(640);return;
      case 'ess_home_addr_default':appendMsg('user','기본 3.8h');essHomeAddrDone(null);return;
      case 'ess_comm_unit_default':appendMsg('user','기본 5kWh');essCommUnit(5);return;
      case 'ess_comm_solar_default':appendMsg('user','기본 100kW');essCommSolar(100);return;
      case 'ess_comm_multi_1':appendMsg('user','1배수');essCommMulti(1);return;
      case 'ess_comm_multi_2':appendMsg('user','2배수');essCommMulti(2);return;
      case 'ess_comm_addr_default':appendMsg('user','기본 3.8h');essCommAddr(null);return;
      case 'ess_comm_discharge_default':appendMsg('user','기본 2h/1회');essCommFinal(2,1);return;
      case 'rev_addr_default':appendMsg('user','기본 3.8h');revAddr(null);return;
      case 'rev_krw':revCurrency('KRW');return;
      case 'rev_usd':revCurrency('USD');return;
      case 'rev_pvcap_default':appendMsg('user','기본 3,300kW');revPvCap(3300);return;
      case 'rev_pvinvest_default':appendMsg('user','기본값');revPvInvest(b.val||3300);return;
      case 'rev_equity_default':appendMsg('user','기본 10%');revEquity(10);return;
      case 'rev_bess_yes':revBessYes();return;
      case 'rev_bess_no':revBessNo();return;
      case 'rev_besscap_default':appendMsg('user','기본 13,200kWh');revBessCap(13200);return;
      case 'rev_bessinvest_default':appendMsg('user','기본값');revBessInvest(b.val||2000);return;
      case 'rev_subsidy_zero':appendMsg('user','없음');revSubsidy(0);return;
      case 'rev_loan_default':appendMsg('user','기본값');revLoan(null);return;
      case 'rev_tax_default':appendMsg('user','기본 10%');revTax(10);return;
      case 'rev_term_default':appendMsg('user','기본 23년');revTerm(23);return;
      case 'rev_smp_default':appendMsg('user','기본값');revSmp(b.val||185);return;
      case 'rev_rec_default':appendMsg('user','기본 75,000');revFinal(75000);return;
      case 'site_yes':siteStart();return;
      case 'site_area_default':appendMsg('user','기본 600㎡');siteAreaDone(600);return;
      case 'site_type_land':appendMsg('user','영농형(토지)');siteType('land');return;
      case 'site_type_roof':appendMsg('user','옥상형(건물)');siteType('roof');return;
      case 'site_3d_guide':
        appendMsg('bot','🎮 3D 조작:\n• 마우스 드래그: 회전\n• 스크롤: 확대·축소\n• 더블클릭: 해당 위치 중심\n• 모바일 핀치: 확대·축소');
        ensureInputVisible();return;
      case 'site_2d_guide':
        appendMsg('bot','🗺️ 분석 결과 하단 "2D 비교" 탭으로 위성사진과 나란히 비교할 수 있습니다.');
        ensureInputVisible();return;
      default:if(b.label)handleFree(b.label);
    }
  }

  /* ── send() ── */
  function send() {
    const inp = inputEl(); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';

    if (inputQueue) {
      // waitInput 대기 중 — 변환 후 resolve
      const q = inputQueue; inputQueue = null;
      const val = q.transform ? q.transform(text) : text;
      appendMsg('user', text);
      chatHistory.push({ role: 'user', content: text });
      q.resolve(val);
      setTimeout(() => ensureInputVisible(), 100);
    } else {
      // waitInput 없음 — 메뉴 라우팅 시도 후 자유 질문
      handleFree(text);
    }
  }

  /* ── 열기/닫기/최소화 ── */
  function open(){
    isOpen=true;isMinimized=false;
    const w=document.getElementById('bk-float-chat');if(!w)return;
    w.classList.remove('bkfc-closed','bkfc-minimized');w.classList.add('bkfc-open');
    const panel=$('bkfcPanel');if(panel)panel.style.display='flex';
    const fab=$('bkfcFab');if(fab)fab.style.display='none';
    const badge=$('bkfcBadge');if(badge)badge.style.display='none';
    ensureInputVisible();
  }
  function close(){
    isOpen=false;isMinimized=false;
    const w=document.getElementById('bk-float-chat');if(!w)return;
    w.classList.add('bkfc-closed');w.classList.remove('bkfc-open','bkfc-minimized');
    const panel=$('bkfcPanel');if(panel)panel.style.display='none';
    const fab=$('bkfcFab');if(fab)fab.style.display='';
  }
  function minimize(){
    isMinimized=true;
    const w=document.getElementById('bk-float-chat');if(!w)return;
    w.classList.add('bkfc-minimized');w.classList.remove('bkfc-open');
    const badge=$('bkfcBadge');if(badge)badge.style.display='block';
  }
  function toggle(){
    if(isOpen&&!isMinimized)close();
    else{open();if(!initiated){initiated=true;welcome();}}
  }

  /* ── 화면 전환 감지 ── */
  function watchViews(){
    if(typeof window.switchView==='function'){
      const orig=window.switchView;
      window.switchView=v=>{orig(v);updateBadge(v);};
    }
    ['home','ess','revenue','site3d','tech','contact'].forEach(v=>{
      const el=document.getElementById('view-'+v);if(!el)return;
      new MutationObserver(()=>{if(el.classList.contains('active'))updateBadge(v);})
        .observe(el,{attributes:true,attributeFilter:['class']});
    });
  }

  function delay(ms){return new Promise(r=>setTimeout(r,ms));}

  /* ── 초기화 ── */
  function init(){
    watchViews();
    const panel=$('bkfcPanel');if(panel)panel.style.display='none';
    const fab=$('bkfcFab');if(fab)fab.onclick=toggle;
    const header=document.querySelector('.bkfc-header');
    if(header){
      header.onclick=e=>{
        if(e.target.closest('.bkfc-header-actions'))return;
        if(isMinimized)open();else minimize();
      };
    }
    const inp=inputEl();
    if(inp){inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});}
    setTimeout(()=>{if(!isOpen&&!initiated){const b=$('bkfcBadge');if(b)b.style.display='block';}},30000);

    // LLM 엔진 상태 콘솔 출력
    const cfg=window.BK_CONFIG?.LLM;
    const hasGroq=!!(cfg?.GROQ_API_KEY);
    const hasMistral=!!(cfg?.MISTRAL_API_KEY);
    console.info(
      '[BKSolarChat v6.0]\n'+
      '  Llama(Groq): '+(hasGroq?'✅ 키 설정됨':'⚠️ GROQ_API_KEY 미설정 → KB 폴백')+'\n'+
      '  Mistral(EU): '+(hasMistral?'✅ 키 설정됨':'⚠️ MISTRAL_API_KEY 미설정 → KB 폴백')
    );
  }

  return{init,toggle,open,close,minimize,send,updateScreenBadge:updateBadge};
})();

window.aiChatSendInput=()=>window.BKSolarChat?.send();
window.aiChatToggle=()=>window.BKSolarChat?.toggle();
