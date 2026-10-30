---
description: Walk the isolations: every isolation in place, its points and lock numbers, every personal lock still on, and any lock left on by someone with no open permit.
---

Run `npm run permits -- isolations` and `npm run permits -- locks`. Lead with locks flagged "no open permit for this person" and isolations that leave a point unlocked (`npm run permits -- compliance`, rules lock-left-on and isolation-incomplete). For each, the person to find or the point to lock. A personal lock comes off only by its owner (`lock-off`); never suggest cutting one without the site's lock removal procedure and a named authoriser.
