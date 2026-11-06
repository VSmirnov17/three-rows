/* Художественные ресурсы: SVG-символы, самоцветы, иконки */
(() => {
  'use strict';

  const SHAPES = {
    oct: 'M32 6 L68 6 L94 32 L94 68 L68 94 L32 94 L6 68 L6 32 Z',
    sun: 'M50 4 L62 20 L82 14 L80 36 L96 50 L80 64 L82 86 L62 80 L50 96 L38 80 L18 86 L20 64 L4 50 L20 36 L18 14 L38 20 Z',
    diamond: 'M50 4 L66 18 L96 50 L66 82 L50 96 L34 82 L4 50 L34 18 Z',
    pent: 'M50 4 L94 36 L78 92 L22 92 L6 36 Z',
    rounded: 'M24 6 H76 Q94 6 94 24 V76 Q94 94 76 94 H24 Q6 94 6 76 V24 Q6 6 24 6 Z',
    hex: 'M30 6 H70 L94 50 L70 94 H30 L6 50 Z'
  };

  const GEMS = [
    {
      name: 'Рубин', shape: 'oct',
      body: ['#ffb49c', '#e13a2f', '#760d13'],
      glyph: '<path d="M52 30c15 0 22 11 18 23-4 13-20 16-26 6-5-9 2-18 10-15 7 2 6 10 1 11"/>'
    },
    {
      name: 'Солнечный камень', shape: 'sun',
      body: ['#fff4ae', '#efa916', '#955806'],
      glyph: '<circle cx="50" cy="50" r="9"/><path d="M50 26v8M50 66v8M26 50h8M66 50h8M33 33l6 6M61 61l6 6M67 33l-6 6M39 61l-6 6"/>'
    },
    {
      name: 'Нефрит', shape: 'diamond',
      body: ['#c6ffab', '#2ea640', '#08561d'],
      glyph: '<path d="M28 70h44M34 58h32M39 46h22M44 34h12M50 22v6"/>'
    },
    {
      name: 'Бирюза', shape: 'pent',
      body: ['#b3f4ff', '#1e7fca', '#083c72'],
      glyph: '<path d="M25 46c9-12 17-12 25 0s16 12 25 0M25 62c9-12 17-12 25 0s16 12 25 0"/>'
    },
    {
      name: 'Аметист', shape: 'rounded',
      body: ['#f0c0ff', '#8c2fc9', '#46106d'],
      glyph: '<path d="M50 28c8 10 14 12 22 22-8 10-14 12-22 22-8-10-14-12-22-22 8-10 14-12 22-22Z"/><circle cx="50" cy="50" r="4"/>'
    },
    {
      name: 'Обсидиан', shape: 'hex',
      body: ['#ffffff', '#b7c1c6', '#626b72'],
      glyph: '<path d="M50 27c12 0 20 9 20 21 0 14-10 24-20 24S30 62 30 48c0-12 8-21 20-21Z"/><path d="M40 45h4M56 45h4M44 60c4 3 8 3 12 0"/>'
    }
  ];

  function buildDefs() {
    let out = '<defs>';

    // ---- Иконки интерфейса ----
    out += `
    <symbol id="icon-menu" viewBox="0 0 100 100">
      <g fill="currentColor"><rect x="20" y="27" width="60" height="9" rx="4.5"/>
      <rect x="20" y="46" width="60" height="9" rx="4.5"/><rect x="20" y="65" width="60" height="9" rx="4.5"/></g>
    </symbol>
    <symbol id="icon-star" viewBox="0 0 100 100">
      <path d="M50 8l11 29 31 2-24 20 8 31-26-17-26 17 8-31L8 39l31-2z" fill="currentColor"/>
    </symbol>
    <symbol id="icon-bolt" viewBox="0 0 100 100">
      <path d="M57 4L22 56h22l-7 40 41-58H52z" fill="currentColor"/>
    </symbol>
    <symbol id="icon-burst" viewBox="0 0 100 100">
      <circle cx="44" cy="59" r="28" fill="currentColor"/>
      <path d="M62 39c7-5 10-13 9-22" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>
      <path d="M79 6l4 9 10 1-8 6 3 10-9-5-9 5 3-10-8-6 10-1z" fill="currentColor"/>
    </symbol>
    <symbol id="icon-totem" viewBox="0 0 100 100">
      <path fill="currentColor" fill-rule="evenodd" d="M41 8h18v33h33v18H59v33H41V59H8V41h33zM50 36l14 14-14 14-14-14z"/>
    </symbol>
    <symbol id="icon-sun" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="22" fill="currentColor"/>
      <g stroke="currentColor" stroke-width="7" stroke-linecap="round">
        <path d="M50 8v13M50 79v13M8 50h13M79 50h13M20 20l9 9M71 71l9 9M80 20l-9 9M29 71l-9 9"/>
      </g>
    </symbol>
    <symbol id="icon-shuffle" viewBox="0 0 100 100">
      <g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 30h16c6 0 10 3 14 8l20 26c4 5 8 8 14 8h12"/>
        <path d="M10 70h16c6 0 10-3 14-8l20-26c4-5 8-8 14-8h12"/>
        <path d="M77 21l12 7-12 7M77 63l12 7-12 7"/>
      </g>
    </symbol>
    <symbol id="icon-sound" viewBox="0 0 100 100">
      <path d="M18 40h14l16-14v48L32 60H18z" fill="currentColor"/>
      <g fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round">
        <path d="M60 36c6 8 6 20 0 28M70 27c11 13 11 33 0 46"/>
      </g>
    </symbol>
    <symbol id="icon-mute" viewBox="0 0 100 100">
      <path d="M18 40h14l16-14v48L32 60H18z" fill="currentColor"/>
      <g stroke="currentColor" stroke-width="7" stroke-linecap="round">
        <path d="M61 38l20 24M81 38L61 62"/>
      </g>
    </symbol>
    <symbol id="icon-check" viewBox="0 0 100 100">
      <path d="M18 53l21 22 43-50" fill="none" stroke="currentColor" stroke-width="12"
        stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-clock" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="7"/>
      <path d="M50 27v25l17 11" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>
    </symbol>
    <symbol id="icon-play" viewBox="0 0 100 100">
      <path d="M32 16l50 34-50 34z" fill="currentColor"/>
    </symbol>
    <symbol id="icon-home" viewBox="0 0 100 100">
      <path d="M12 48L50 14l38 34" fill="none" stroke="currentColor" stroke-width="8"
        stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M24 46v36h52V46" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round"/>
    </symbol>
    <symbol id="icon-restart" viewBox="0 0 100 100">
      <path d="M78 38a33 33 0 1 0 5 26" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
      <path d="M82 16v24H58" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
`;

    out += '</defs>';
    return out;
  }

  function gemSvg(color, cls) {
    return `<img class="${cls || 'gem-svg'}" src="assets/gems/gem-${color}.png" alt="" draggable="false">`;
  }

  // Иконки спецкамней: тип не должен сводиться к 'line' по умолчанию
  const SPECIAL_ICON = {
    line: 'icon-bolt',
    sun: 'icon-star',
    bomb: 'icon-burst',
    totem: 'icon-totem'
  };

  function gemInner(color, special) {
    let extra = '';
    if (special) {
      const icon = SPECIAL_ICON[special] || 'icon-star';
      extra = `<span class="special-icon"><svg viewBox="0 0 100 100"><use href="#${icon}"></use></svg></span>`;
    }
    return `<div class="gem-inner">${gemSvg(color)}${extra}</div>`;
  }

  function icon(id, cls) {
    return `<svg class="${cls || ''}" viewBox="0 0 100 100" aria-hidden="true"><use href="#${id}"></use></svg>`;
  }

  window.ART = {
    GEMS, SHAPES, buildDefs, gemSvg, gemInner, icon,
    init() {
      document.getElementById('svg-defs').innerHTML = buildDefs();
      const shamanHost = document.getElementById('shamanArt');
      if (shamanHost && this.shaman) shamanHost.innerHTML = this.shaman();
      const leavesHost = document.getElementById('leaves');
      if (leavesHost && this.leaves) leavesHost.innerHTML = this.leaves();
    }
  };
})();
