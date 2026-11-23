---
description: Ant Design forms rendered together in dialogs or nested modals
applyTo: 'fe/src/**/*.jsx'
---

Give every Ant Design Form on the same page a distinct `name`, including forms in hidden or nested modals. Ant builds input IDs from the Form name and field path; two unnamed forms with `fullName` can leave an edit dialog label pointing to the generator's hidden input. For example, use `name="admin-user-form"` and `name="import-workbook-generator"`, then verify `getByLabel` and keyboard focus after closing the generator and opening the edit dialog.

When screenshots are used as validation, wait for the real data response and loading skeleton to disappear before capturing desktop/mobile. A screenshot of a loading state does not establish that the loaded table or form fits the viewport.
