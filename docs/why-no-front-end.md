# Why there is no front end

A permit to work system is a set of records: permits, the people on them and their tickets, isolations with their points and locks, gas readings, who went in and who came out. The rules that matter are checks across those records: no work on plant nobody proved dead, no entry on a stale gas test, no lock left on after the job is closed. What a permit system sells on top is the screens and the forms.

Here the records sit in a database you own, the rules run as plain queries, and the people who run permits ask in their own words: who is inside right now, which locks are still on, who on today's permits has a lapsed ticket.

## What you gain

- **Answers across everything.** "Which assets have we isolated most in 90 days, and for how many hours?" is one question, not a report request.
- **No seats.** Every issuer, receiver, isolator and contractor can be on record without a licence each.
- **Your records in your database.** Back them up, query them from anything, keep them as long as your retention rules say.
- **Your procedure, not the vendor's.** Your permit kinds, your clash rules, your gas limits, your ticket list, changed in plain language with /customise.

## What a screen gives that this does not

- **A phone in the field.** Crews sign on, test gas and record entries on a phone or tablet in most permit systems. Here a coordinator records it, or Enterprise DNA builds a phone screen into your version.
- **Offline use.** Plant rooms and silos have poor coverage. A printed permit and entry log (`npm run docs`) carry the site through; the records are entered when back in coverage.
- **Signatures and photos.** This base records the name and time. A signature pad, photos of the lock-out and a QR code on the lockbox are part of a custom version.
- **A wall board.** `npm run view` renders a board page you can put on a screen in the control room and refresh. It is read-only by design.

## Who this fits

Sites with one coordinator or a small maintenance team who raise permits at a desk and want the checks done properly: food and grain processors, mills, packhouses, water and wastewater plants, small manufacturers and the contractors who work for them. If every crew member signs on from their own phone all day, you need a phone screen, and that is what Enterprise DNA builds into your version.

Installed and run for you: https://enterprisedna.co/omni/instead-of/ipermit
