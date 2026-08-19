# Issue 190 / v0.1.44 Windows ACL Recovery Regression Guide

## Automated checks

1. `Windows sandbox ACL recovery found a foreign or unverifiable owner marker.`
   projects as bounded ACL cleanup state with restart/doctor guidance and no
   Setup action.
2. A blocked startup settlement never reaches owner reconciliation, startup
   preparation, or Runtime initialization.
3. Chinese and English blocker notices offer the boot-dialog “Open diagnostics
   folder” action; they do not expose raw SDK messages, paths, or control
   characters.
4. Existing `clean`, `recovered`, `keep-open`, ordinary-startup, and ambiguous
   prepared-ticket routing remains unchanged.
5. `manual-recovery` ACL blocks direct the user to support instead of another
   ineffective reboot; generic `nextAction` values remain bounded.

## Windows manual acceptance

1. Launch Space with a retained Runtime exit ticket and a same-boot foreign ACL
   marker. Verify Space starts no competing Coder Runtime and shows the localized
   recovery notice.
2. Verify startup does not show UAC and does not invoke sandbox Setup.
3. On the blocking boot surface, select “Open diagnostics folder” and verify the
   main-process log directory opens without admitting normal renderer startup.
4. After the fixed SDK is published and integrity-pinned, restart Windows and
   relaunch with two valid previous-boot markers. Verify settlement completes
   before owner reconciliation and Space no longer shows the blocker.
5. Repeat with a current-boot, identity-free, or corrupt marker. Verify startup
   remains blocked and the diagnostic evidence is retained.
