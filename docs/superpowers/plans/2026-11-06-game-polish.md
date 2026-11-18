# Game polish implementation plan

Approved scope: the six improvements proposed in chat, accepted with «исправляй».
Keep plain HTML/CSS/JavaScript and the existing match-three rules and gem sprites.

- [x] Fix duplicate desktop menu and queue pause safely during board animations. Verify menu, resume, restart, and input after resume.
- [x] Place mobile tools directly below the board; enlarge goal and hint labels. Verify 390×844, 320×568, and 1440×900 without overlap or horizontal overflow.
- [x] Generate a jungle temple backdrop and transparent jade/gold sun medallion; save optimized assets in the repo, update consumers, preserve originals. Verify loading and composition at both sizes.
- [x] Mute the complete audio graph including reverb; expand music form, improve bass audibility, reduce effect reverb. Verify with an audio graph regression check and syntax checks.
- [x] Independent review, browser gameplay verification, console errors, and economy simulation. Record limitations honestly.

Validation: browser at 1440×900, 390×844, 320×568; swipe/cascade, queued pause, resume and restart. Mock audio graph and scheduler pass. No subjective audio listening was possible through the browser tool.
