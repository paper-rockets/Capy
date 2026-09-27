// ---------------------------------------------------------------------------
// The game's screen layout, after Capy\final_gameplay_visual_target.png:
// wooden place sign (top left), Sun Points / Friendship / Golden Leaves (top right),
// the Quests card (bottom left), and a banner for big moments (top middle).
// Real text and buttons in HTML, so it stays sharp at any size.
// ---------------------------------------------------------------------------

const ICONS = {
  sun: `<svg viewBox="0 0 40 40"><g fill="#ffc53a" stroke="#e08a12" stroke-width="2"><circle cx="20" cy="20" r="9"/>${
    Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4;
      const x1 = 20 + Math.cos(a) * 12.5;
      const y1 = 20 + Math.sin(a) * 12.5;
      const x2 = 20 + Math.cos(a) * 18;
      const y2 = 20 + Math.sin(a) * 18;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke-linecap="round" stroke-width="3.5"/>`;
    }).join('')}</g></svg>`,
  heart: `<svg viewBox="0 0 40 40"><path d="M20 34C6 25 4 15 9 10c4-4 9-3 11 1 2-4 7-5 11-1 5 5 3 15-11 24z" fill="#ff5f7e" stroke="#c93556" stroke-width="2.2" stroke-linejoin="round"/><ellipse cx="13" cy="15" rx="3" ry="2" fill="#fff" opacity="0.6"/></svg>`,
  leaf: `<svg viewBox="0 0 40 40"><path d="M8 32C6 16 16 6 34 6c0 18-10 28-26 26z" fill="#f2b632" stroke="#c07d12" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 31L27 13" stroke="#c07d12" stroke-width="2" stroke-linecap="round"/></svg>`,
  sprout: `<svg viewBox="0 0 40 40"><path d="M20 34V19" stroke="#4d8a2a" stroke-width="3" stroke-linecap="round"/><path d="M20 21c0-7-5-11-12-11 0 7 5 11 12 11z" fill="#7cc242" stroke="#4d8a2a" stroke-width="2"/><path d="M20 19c0-6 4-9 11-9 0 6-4 9-11 9z" fill="#9bd65a" stroke="#4d8a2a" stroke-width="2"/></svg>`,
  duck: `<svg viewBox="0 0 40 40"><ellipse cx="20" cy="26" rx="12" ry="8" fill="#ffd84a" stroke="#d49a12" stroke-width="2"/><circle cx="25" cy="15" r="7" fill="#ffd84a" stroke="#d49a12" stroke-width="2"/><path d="M31 15l6 2-6 2z" fill="#ff9a2e" stroke="#d46a12" stroke-width="1.5" stroke-linejoin="round"/><circle cx="26.5" cy="13.5" r="1.5" fill="#3a2a1a"/></svg>`,
};

const CSS = `
  .hud-sign { position: fixed; top: 12px; left: 12px; display: flex; align-items: center; gap: 10px; padding: 7px 18px 8px 10px;
    border-radius: 16px; background: linear-gradient(#8c5b33, #6a4224); color: #fff4dc; border: 3px solid #b27b48;
    box-shadow: 0 3px 0 #4b2d15, 0 8px 18px rgba(0,0,0,0.25); pointer-events: none; }
  .hud-sign svg { width: 38px; height: 38px; flex: none; }
  .hud-sign b { display: block; font-size: 22px; font-weight: 900; line-height: 1.05; letter-spacing: 0.2px; }
  .hud-sign small { display: block; font-size: 12px; font-weight: 700; opacity: 0.92; }
  .hud-counters { position: fixed; top: 12px; right: 12px; display: flex; gap: 10px; pointer-events: none; }
  .hud-count { display: flex; flex-direction: column; align-items: center; }
  .hud-pill { display: flex; align-items: center; gap: 6px; min-width: 92px; padding: 3px 14px 3px 5px; border-radius: 999px;
    background: #fff6e4; border: 3px solid #7a4d27; box-shadow: 0 3px 0 #4b2d15, 0 6px 12px rgba(0,0,0,0.2);
    font: 900 19px Nunito, sans-serif; color: #4a2d14; }
  .hud-pill svg, .hud-pill img { width: 32px; height: 32px; flex: none; object-fit: contain; margin: -3px 0; filter: drop-shadow(0 1px 1px rgba(0,0,0,0.25)); }
  .hud-pill span { flex: 1; text-align: right; }
  .hud-pill.bump { animation: hud-bump 0.5s ease-out; }
  @keyframes hud-bump { 30% { transform: scale(1.18); } 100% { transform: scale(1); } }
  .hud-count label { margin-top: 3px; font: 800 12px Nunito, sans-serif; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
  .hud-quests { position: fixed; left: 12px; bottom: 12px; width: 270px; padding: 10px 14px 10px; border-radius: 14px;
    background: #fbf1dc; border: 3px solid #b58a58; box-shadow: 0 4px 0 #8a6236, 0 10px 20px rgba(0,0,0,0.25); color: #4a2d14; }
  .hud-quests h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 6px; font: 900 18px Nunito, sans-serif;
    border-bottom: 2px solid #e2cfa8; padding-bottom: 5px; }
  .hud-quests h3 svg { width: 24px; height: 24px; }
  .hud-q { display: flex; align-items: center; gap: 8px; margin: 5px 0; font: 800 14px Nunito, sans-serif; }
  .hud-q i { flex: none; width: 16px; height: 16px; border: 2.5px solid #9a7550; border-radius: 4px; background: #fff; position: relative; }
  .hud-q.done i { background: #5fae3a; border-color: #3f7d22; }
  .hud-q.done i::after { content: ''; position: absolute; left: 4px; top: 0px; width: 5px; height: 9px; border: solid #fff; border-width: 0 3px 3px 0; transform: rotate(45deg); }
  .hud-q.done em { text-decoration: line-through; opacity: 0.65; }
  .hud-q em { flex: 1; font-style: normal; }
  .hud-q b { font-weight: 900; }
  .hud-q .sub { display: block; font-size: 12px; font-weight: 700; opacity: 0.75; }
  .hud-toast { position: fixed; top: 76px; left: 50%; transform: translate(-50%, -20px); opacity: 0; transition: opacity 0.35s, transform 0.35s;
    display: flex; align-items: center; gap: 10px; max-width: min(560px, calc(100% - 24px)); padding: 10px 18px 11px 12px; border-radius: 16px;
    background: #fbf1dc; border: 3px solid #b58a58; box-shadow: 0 4px 0 #8a6236, 0 10px 22px rgba(0,0,0,0.3);
    font: 800 16px Nunito, sans-serif; color: #4a2d14; pointer-events: none; }
  .hud-toast.on { opacity: 1; transform: translate(-50%, 0); }
  .hud-toast svg { width: 34px; height: 34px; flex: none; }
  .hud-toast img { width: 72px; height: 72px; flex: none; object-fit: contain; margin: -14px 0 -10px -4px; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.2)); }
  .hud-q img { flex: none; width: 34px; height: 34px; object-fit: contain; margin: -4px -2px; }
  .hud-toast b { display: block; font-size: 18px; font-weight: 900; }
  .hud-tools { position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); display: flex; gap: 8px; padding: 8px 10px 16px;
    border-radius: 18px; background: linear-gradient(#8c5b33, #6a4224); border: 3px solid #b27b48; box-shadow: 0 4px 0 #4b2d15, 0 10px 20px rgba(0,0,0,0.3); }
  .hud-tool { position: relative; width: 62px; height: 62px; border-radius: 13px; background: #fbf1dc; border: 3px solid #d9b98a;
    display: grid; place-items: center; padding: 0; cursor: pointer; box-shadow: 0 2px 0 #b58a58 inset; transition: transform 0.12s; }
  .hud-tool img { width: 50px; height: 50px; object-fit: contain; filter: drop-shadow(0 2px 1px rgba(0,0,0,0.2)); pointer-events: none; }
  .hud-tool span { position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%); min-width: 18px; padding: 0 4px; border-radius: 6px;
    background: #fff6e4; border: 2px solid #7a4d27; font: 900 11px/14px Nunito, sans-serif; color: #4a2d14; }
  .hud-tool.on { background: #fff3b8; border-color: #f2b632; box-shadow: 0 0 0 3px #ffd84a, 0 0 14px 4px rgba(255, 216, 74, 0.8); transform: translateY(-3px); }
  .hud-pick { position: fixed; left: 50%; bottom: 104px; transform: translate(-50%, 16px) scale(0.92); opacity: 0; pointer-events: none;
    transition: opacity 0.2s, transform 0.2s; padding: 10px 14px 14px; border-radius: 18px; background: #fbf1dc; border: 3px solid #b58a58;
    box-shadow: 0 4px 0 #8a6236, 0 12px 24px rgba(0,0,0,0.3); color: #4a2d14; text-align: center; }
  .hud-pick.on { opacity: 1; transform: translate(-50%, 0) scale(1); pointer-events: auto; }
  .hud-pick h4 { margin: 0 0 8px; font: 900 17px Nunito, sans-serif; }
  .hud-pick .row { display: flex; gap: 10px; }
  .hud-pick button { width: 84px; padding: 6px 4px 5px; border-radius: 14px; background: #fff; border: 3px solid #d9b98a; cursor: pointer;
    font: 800 13px Nunito, sans-serif; color: #4a2d14; box-shadow: 0 3px 0 #b58a58; }
  .hud-pick button:active { transform: translateY(2px); box-shadow: 0 1px 0 #b58a58; }
  .hud-pick button img { display: block; width: 56px; height: 56px; margin: 0 auto 2px; object-fit: contain; filter: drop-shadow(0 2px 1px rgba(0,0,0,0.2)); }
  .hud-pick .x { position: absolute; top: -12px; right: -12px; width: 32px; height: 32px; padding: 0; border-radius: 50%; font: 900 18px/26px Nunito, sans-serif; }
  #hint { bottom: 104px !important; transition: opacity 1s; }
  #hint.gone { opacity: 0; }
  .hud-quests h3 { cursor: pointer; pointer-events: auto; }
  .hud-quests h3::after { content: '▾'; margin-left: auto; font-size: 14px; opacity: 0.6; }
  .hud-quests.min h3 { margin: 0; border: 0; padding: 0; }
  .hud-quests.min h3::after { content: '▸'; }
  .hud-quests.min .hud-q { display: none; }
  .hud-dlg { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(40, 25, 10, 0.4);
    opacity: 0; pointer-events: none; transition: opacity 0.25s; }
  .hud-dlg.on { opacity: 1; pointer-events: auto; }
  .hud-dlg .box { position: relative; width: min(360px, calc(100% - 32px)); margin-top: 30px; padding: 16px 20px 20px; border-radius: 22px;
    background: #fbf1dc; border: 3px solid #b58a58; box-shadow: 0 5px 0 #8a6236, 0 16px 34px rgba(0,0,0,0.35);
    color: #4a2d14; text-align: center; font: 800 15px Nunito, sans-serif; transform: scale(0.9); transition: transform 0.25s; }
  .hud-dlg.on .box { transform: scale(1); }
  .hud-dlg .art { display: block; width: 104px; height: 104px; object-fit: contain; margin: -64px auto 0; filter: drop-shadow(0 3px 3px rgba(0,0,0,0.25)); }
  .hud-dlg h2 { margin: 2px 0 6px; font: 900 25px Nunito, sans-serif; }
  .hud-dlg p { margin: 0 0 16px; line-height: 1.35; }
  .hud-dlg p img { width: 24px; height: 24px; vertical-align: -6px; object-fit: contain; }
  .hud-dlg .btns { display: flex; flex-direction: column; gap: 11px; }
  .hud-dlg button { padding: 12px 10px; border-radius: 15px; border: 3px solid #3f7d22; background: linear-gradient(#86cc4a, #5fae3a);
    color: #fff; font: 900 20px Nunito, sans-serif; text-shadow: 0 1px 2px rgba(0,0,0,0.3); box-shadow: 0 4px 0 #3f7d22; cursor: pointer; }
  .hud-dlg button.plain { background: #fff; color: #4a2d14; border-color: #d9b98a; box-shadow: 0 4px 0 #b58a58; text-shadow: none; font-size: 16px; padding: 9px; }
  .hud-dlg button.warn { background: linear-gradient(#ff8f6c, #e2603c); border-color: #b8452a; box-shadow: 0 4px 0 #b8452a; }
  .hud-dlg button:active { transform: translateY(3px); box-shadow: 0 1px 0 rgba(0,0,0,0.25); }
  /* short screens (a phone held sideways): everything smaller, so the meadow stays visible */
  @media (max-height: 520px) {
    .hud-dlg .box { padding: 10px 16px 14px; margin-top: 20px; } .hud-dlg .art { width: 64px; height: 64px; margin-top: -40px; }
    .hud-dlg h2 { font-size: 19px; margin-bottom: 3px; } .hud-dlg p { font-size: 13px; margin-bottom: 10px; }
    .hud-dlg .btns { gap: 8px; } .hud-dlg button { font-size: 16px; padding: 8px; } .hud-dlg button.plain { font-size: 14px; padding: 6px; }
    .hud-sign { top: 8px; left: 8px; padding: 4px 12px 5px 7px; gap: 6px; border-width: 2px; }
    .hud-sign b { font-size: 16px; } .hud-sign small { display: none; } .hud-sign svg { width: 24px; height: 24px; }
    .hud-counters { top: 8px; right: 8px; gap: 6px; }
    .hud-pill { min-width: 64px; font-size: 14px; padding: 1px 9px 1px 3px; border-width: 2px; }
    .hud-pill svg, .hud-pill img { width: 22px; height: 22px; margin: 0; }
    .hud-count label { display: none; }
    .hud-quests { left: 8px; bottom: 8px; width: 215px; padding: 6px 9px; border-width: 2px; }
    .hud-quests h3 { font-size: 14px; margin-bottom: 3px; padding-bottom: 3px; } .hud-quests h3 svg { width: 18px; height: 18px; }
    .hud-q { font-size: 12px; margin: 3px 0; gap: 6px; } .hud-q .sub { display: none; } .hud-q img { width: 24px; height: 24px; }
    .hud-q i { width: 13px; height: 13px; border-width: 2px; }
    .hud-toast { top: 44px; font-size: 13px; padding: 6px 12px 7px 8px; max-width: min(460px, calc(100% - 16px)); border-width: 2px; }
    .hud-toast b { font-size: 14px; } .hud-toast img { width: 46px; height: 46px; margin: -8px 0 -6px -2px; }
    .hud-tools { bottom: 8px; gap: 5px; padding: 5px 6px 11px; border-width: 2px; border-radius: 13px; }
    .hud-tool { width: 42px; height: 42px; border-radius: 9px; border-width: 2px; } .hud-tool img { width: 34px; height: 34px; }
    .hud-tool span { bottom: -10px; font-size: 9px; line-height: 11px; min-width: 14px; border-width: 1.5px; }
    #hint { bottom: 70px !important; }
    .hud-pick { bottom: 68px; padding: 6px 10px 10px; } .hud-pick h4 { font-size: 14px; margin-bottom: 5px; }
    .hud-pick button { width: 64px; font-size: 11px; } .hud-pick button img { width: 38px; height: 38px; }
  }
  @media (max-width: 700px) {
    .hud-sign b { font-size: 17px; } .hud-sign small { display: none; } .hud-sign svg { width: 28px; height: 28px; }
    .hud-pill { min-width: 0; font-size: 15px; padding-right: 9px; } .hud-pill svg, .hud-pill img { width: 24px; height: 24px; }
    .hud-toast img { width: 54px; height: 54px; }
    .hud-count label { display: none; }
    .hud-quests { width: 210px; padding: 8px 10px; } .hud-q { font-size: 12px; }
  }
`;

export interface Quest { id: string; text?: string; sub?: string; count?: number; total?: number; done?: boolean; /** picture in public/ui */ icon?: string }

/** A painted picture from public/ui (cut by tools/cut_ui.py). */
const pic = (name: string) => `<img src="ui/${name}.webp" alt="" draggable="false">`;
/** Loaded at the start, so a message's picture is there the moment it pops up. */
const PRELOAD = ['icon_sun', 'icon_heart', 'icon_leaf', 'mama_happy', 'mama_talk', 'mama_sad', 'duckling_sad', 'duckling_call', 'duckling_happy', 'duck_family', 'pin_duckling', 'tool_hand',
  'crop_carrot', 'crop_tomato', 'crop_melon', 'crop_bamboo', 'tool_water', 'tool_seeds', 'tool_basket', 'tool_hammer',
  'mochi_happy', 'mochi_proud', 'mochi_think', 'mochi_surprised', 'btn_full_exit'];

export function createHud(place: { name: string; blurb: string }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  for (const n of PRELOAD) new Image().src = `ui/${n}.webp`;

  const sign = document.createElement('div');
  sign.className = 'hud-sign';
  sign.innerHTML = `${ICONS.sun}<div><b>${place.name}</b><small>${place.blurb}</small></div>`;
  document.body.appendChild(sign);

  const counters = document.createElement('div');
  counters.className = 'hud-counters';
  const values = { sun: 0, hearts: 0, leaves: 0 };
  // painted coins and heart (tools/cut_ui.py)
  const COUNTERS: [keyof typeof values, string, string][] = [['sun', pic('icon_sun'), 'Sun Points'], ['hearts', pic('icon_heart'), 'Friendship'], ['leaves', pic('icon_leaf'), 'Golden Leaves']];
  for (const [key, icon, label] of COUNTERS) {
    const el = document.createElement('div');
    el.className = 'hud-count';
    el.innerHTML = `<div class="hud-pill" data-k="${key}">${icon}<span>0</span></div><label>${label}</label>`;
    counters.appendChild(el);
  }
  document.body.appendChild(counters);

  const quests = document.createElement('div');
  quests.className = 'hud-quests';
  document.body.appendChild(quests);
  const list: Quest[] = [];
  quests.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('h3')) quests.classList.toggle('min');
  });
  const drawQuests = () => {
    quests.innerHTML = `<h3>${ICONS.sprout}Quests</h3>` + list.map((q) => `
      <div class="hud-q${q.done ? ' done' : ''}"><i></i>${q.icon ? pic(q.icon) : ''}<em>${q.text}${q.sub && !q.done ? `<span class="sub">${q.sub}</span>` : ''}</em>${
        q.total ? `<b>${q.count ?? 0}/${q.total}</b>` : ''}</div>`).join('');
  };

  const toastEl = document.createElement('div');
  toastEl.className = 'hud-toast';
  document.body.appendChild(toastEl);
  let toastTimer = 0;

  // --- tool bar (bottom middle): tap a tool or press its number key
  const toolsEl = document.createElement('div');
  toolsEl.className = 'hud-tools';
  document.body.appendChild(toolsEl);
  let toolIds: string[] = [];
  let current = '';
  let onPick: (id: string) => void = () => {};
  const selectTool = (id: string) => {
    current = id;
    toolsEl.querySelectorAll('.hud-tool').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.id === id));
    onPick(id);
  };
  toolsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.hud-tool') as HTMLElement | null;
    if (b) selectTool(b.dataset.id!);
  });
  window.addEventListener('keydown', (e) => {
    const n = Number(e.key);
    if (n >= 1 && n <= toolIds.length) selectTool(toolIds[n - 1]);
  });
  // --- a small chooser above the tool bar (which seeds to plant)
  const pickEl = document.createElement('div');
  pickEl.className = 'hud-pick';
  document.body.appendChild(pickEl);
  let pickDone: ((id: string | null) => void) | null = null;
  const closePick = (id: string | null) => {
    pickEl.classList.remove('on');
    const done = pickDone;
    pickDone = null;
    done?.(id);
  };
  pickEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (b) closePick(b.dataset.id ?? null);
  });
  // the "tap to walk" tip fades away after a while
  setTimeout(() => document.getElementById('hint')?.classList.add('gone'), 9000);

  // --- a pop-up box in the middle of the screen (start, menu, "are you sure?")
  const dlgEl = document.createElement('div');
  dlgEl.className = 'hud-dlg';
  document.body.appendChild(dlgEl);
  let dlgDone: ((id: string) => void) | null = null;
  dlgEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b || !dlgDone) return;
    const done = dlgDone;
    dlgDone = null;
    dlgEl.classList.remove('on');
    done(b.dataset.id!);
  });

  const fmt = (n: number) => n.toLocaleString('en-US');
  return {
    /** add to a counter, with a little bounce */
    add(key: keyof typeof values, n: number) {
      values[key] += n;
      const pill = counters.querySelector(`[data-k="${key}"]`) as HTMLElement;
      pill.querySelector('span')!.textContent = fmt(values[key]);
      pill.classList.remove('bump');
      void pill.offsetWidth; // restart the animation
      pill.classList.add('bump');
    },
    get: (key: keyof typeof values) => values[key],
    /** set a counter straight to a number (loading a saved game), no bounce */
    set(key: keyof typeof values, n: number) {
      values[key] = n;
      (counters.querySelector(`[data-k="${key}"] span`) as HTMLElement).textContent = fmt(n);
    },
    /** a pop-up box with big buttons; resolves with the id of the button pressed. style: '' (green), 'plain' or 'warn' */
    dialog(title: string, text: string, picture: string, buttons: { id: string; label: string; style?: string }[]): Promise<string> {
      dlgEl.innerHTML = `<div class="box">${picture ? `<img class="art" src="ui/${picture}.webp" alt="">` : ''}<h2>${title}</h2><p>${text}</p><div class="btns">${
        buttons.map((b) => `<button data-id="${b.id}" class="${b.style ?? ''}">${b.label}</button>`).join('')}</div></div>`;
      dlgEl.classList.add('on');
      return new Promise((resolve) => { dlgDone = resolve; });
    },
    dialogOpen: () => !!dlgDone,
    /** set up the tool bar: [id, picture, name] */
    tools(list: [string, string, string][], pick: (id: string) => void) {
      toolIds = list.map((t) => t[0]);
      onPick = pick;
      toolsEl.innerHTML = list.map(([id, picture, name], i) => `<button class="hud-tool" data-id="${id}" title="${name}" aria-label="${name}">${pic(picture)}<span>${i + 1}</span></button>`).join('');
      selectTool(toolIds[0]);
    },
    /** pick a tool from code (e.g. back to the hand after the map closes) */
    selectTool,
    tool: () => current,
    quest(q: Quest) {
      // new quests need a text; updates can change just the count or done
      const i = list.findIndex((o) => o.id === q.id);
      if (i >= 0) list[i] = { ...list[i], ...q };
      else list.push(q);
      drawQuests();
    },
    /** ask the player to choose one of a few things; done(null) if they close it */
    choose(title: string, options: { id: string; icon: string; label: string }[], done: (id: string | null) => void) {
      if (pickDone) closePick(null);
      pickEl.innerHTML = `<h4>${title}</h4><div class="row">${options.map((o) => `<button data-id="${o.id}">${pic(o.icon)}${o.label}</button>`).join('')}</div><button class="x" aria-label="Close">×</button>`;
      pickDone = done;
      pickEl.classList.add('on');
    },
    closeChooser: () => closePick(null),
    choosing: () => !!pickDone,
    /** a message for a big moment; picture = a public/ui picture name (or one of the drawn icons) */
    toast(title: string, text: string, picture = 'duckling_sad', secs = 4) {
      const art = picture in ICONS ? ICONS[picture as keyof typeof ICONS] : pic(picture);
      toastEl.innerHTML = `${art}<div><b>${title}</b>${text}</div>`;
      toastEl.classList.add('on');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), secs * 1000);
    },
  };
}
export type Hud = ReturnType<typeof createHud>;
