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

## Done
- [x] Android: install, basic screens, status bar spacing, Quick log (Nov 26)
- [x] Android: network check on home Wi-Fi (Nov 26)
