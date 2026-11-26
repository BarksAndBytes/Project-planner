# Things to test on real devices

Claude keeps this list up to date as features land. Everything here has passed automated tests and simulated runs; these checks need a real phone, PC, or network. Newest builds: [Android](https://github.com/BarksAndBytes/Project-planner/releases/download/test-build/WorkDashboard-test.apk) · [Windows](https://github.com/BarksAndBytes/Project-planner/releases/download/test-build/WorkDashboard-test-x64.msi).

Tick items off (or tell Claude what happened) as you go. Report anything odd with a screenshot.

## Waiting for you

### Phase 1 basics on Windows
- [ ] Windows installer runs (More info → Run anyway) and the app opens
- [ ] Create a project, task and log entry; close the app fully; reopen: everything is still there (proves encryption at rest works with Windows Data Protection)
- [ ] Palettes and Light/Dark look right on the PC

### Network check (Settings → Network check)
- [ ] Home Wi-Fi: computer shows code, phone scans, both show ✓
- [ ] Windows asks about the firewall the first time; allowing it on private networks works
- [ ] **Work Wi-Fi** (the important one): does it pass? If not, what did the phone say?
- [ ] "Type the address instead" works if you skip the camera

### Sync group and sync (Settings → Sync and devices)
- [ ] Computer: Create a sync group, then Add a phone. Phone: Scan code. Both show the same 4 words; confirm on the computer; both say ✓
- [ ] Projects made on each device before joining appear on both afterwards
- [ ] Edit something on each device, then computer Sync now + phone Scan code: both edits arrive on both
- [ ] Same field edited on both devices: the later edit wins on both
- [ ] Delete a project on one device, sync: it disappears on the other
- [ ] Dashboard shows "Last synced …"; after a day without syncing it turns amber with "Sync now"
- [ ] Rename this device (Settings → Sync and devices → This device)
- [ ] Set the phone to View-only on the computer, sync: the phone refuses edits with a clear message; set back to Full
- [ ] Remove the phone on the computer, sync: refused with "isn't in your sync group"; add it back with Add a phone
- [ ] Second computer (if you have one): it shows "Join an existing group", a member phone scans it, it receives everything
- [ ] Close the app and reopen on both: still in the group and still syncing (identity keys survive restarts)

### Work summary export (Projects → Work summary, or a project's Summary button)
- [ ] Preview looks right for "This quarter" with a few real entries; wording changes read well, and "undo wording" restores your words
- [ ] Windows: Word (.docx) saves to Downloads; "Show in folder" opens Explorer on it; it opens cleanly in Word
- [ ] Android: Word (.docx) opens the share sheet; sending to Word / Drive / email works and the file opens
- [ ] Copy as text, then paste into an email or Teams: layout is readable
- [ ] CSV opens in Excel with one row per log entry
- [ ] Windows: Print / PDF prints only the summary, black on white
- [ ] "Since my last review" uses the date set in Settings (once that setting has a screen; for now it falls back to Jan 1)

### Voice input (Quick log → 🎤 Speak)
- [ ] Android: Speak opens the phone's speech prompt; the words land in the box
- [ ] Android: works with Wi-Fi and mobile data off once offline speech is set up (Settings → Google → Voice → Offline speech, download English)
- [ ] Saying "Win: …", "Problem: …", "Blocked: …" sets Success / Failure / Blocker and drops the keyword
- [ ] Windows: Speak opens Windows voice typing in the box; speaking types the text
- [ ] Typing "Win: ..." by hand also sets the type when you leave the box

### Backup and reminders (Settings)
- [ ] Save encrypted backup: Windows saves a .wdbackup file to Downloads; Android opens the share sheet (save it to Drive or a USB stick)
- [ ] Restore from a backup on another device (or after reinstalling): choose the file, enter the passphrase, projects come back. **Android: check the file picker opens at all** (it may not, in which case restore on Windows for now)
- [ ] A wrong passphrase is refused with a clear message
- [ ] Dashboard shows "You haven't saved a backup yet" until you do, and again after a week
- [ ] Turn on the Friday reminder: on a Friday the dashboard asks about the week's wins and "Log a win" opens Quick log as a Success
- [ ] Set "Date of your last review", then Work summary → "Since my last review" starts there

### App lock, kiosk mode, search, Claude add-on (Settings)
- [ ] App lock: turn on, close the app fully, reopen: it asks for the passcode; wrong passcode is refused; 5 wrong tries block entry for 5 minutes
- [ ] Kiosk mode on a tablet or spare PC: everything visible but read-only; Unlock with its passcode allows changes; it relocks after 5 idle minutes and on Lock; touch targets are bigger
- [ ] Sync still works on a locked kiosk (it receives changes), but Add a phone and device changes are hidden
- [ ] Projects → Search all finds projects (by customer, part number…), tasks and log entries
- [ ] Settings → Claude add-on → Work summary shows Copy for Claude; pasting into Claude gives the prompt and entries
- [ ] Settings → About → Version and security log opens

## Done
- [x] Android: install, basic screens, status bar spacing, Quick log (Nov 26)
- [x] Android: network check on home Wi-Fi (Nov 26)
