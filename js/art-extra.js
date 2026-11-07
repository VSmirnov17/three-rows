/* Джунгли: фон и листья */
(() => {
  'use strict';

  function leaves() {
    const spots = [
      { x: -5, y: -8, s: 1.5, r: -32, o: 0.62 },
      { x: 88, y: -10, s: 1.7, r: 28, o: 0.58 },
      { x: -7, y: 48, s: 1.2, r: 64, o: 0.46 },
      { x: 92, y: 40, s: 1.35, r: -58, o: 0.5 },
      { x: 14, y: 82, s: 1.1, r: 118, o: 0.42 },
      { x: 72, y: 88, s: 1.25, r: -112, o: 0.45 },
      { x: 30, y: -12, s: 0.9, r: -6, o: 0.34 },
      { x: 60, y: -14, s: 1, r: 12, o: 0.3 },
      { x: -2, y: 14, s: 0.8, r: 42, o: 0.36 },
      { x: 94, y: 8, s: 0.9, r: -40, o: 0.38 },
    ];

    const scenery = `<img class="scenery-img" src="assets/art/jungle.png" alt="" draggable="false">`;

    return scenery + spots.map(p => `<span class="leaf" style="left:${p.x}%;top:${p.y}%;width:${p.s * 160}px;opacity:${p.o};transform:rotate(${p.r}deg)">
      <img src="assets/art/leaf.png" alt="" draggable="false">
    </span>`).join('');
  }

  ART.leaves = leaves;
})();
