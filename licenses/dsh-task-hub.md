# dsh-task-hub attribution

The TAPD client adapts the list request/query, response wrapper, pagination,
and story URL conventions from [dsh-task-hub `lib/tapd.js`][source], pinned to
commit `053282f1fe1a79bb257439926c3af06b3ef5f0a1`. Copyright © 2026 handsome-65;
licensed under the MIT License, preserved in [dsh-task-hub.LICENSE][license].

This adaptation restricts requests to the official API, does not follow
redirects or retry with credentials in the query, adds separate Task support,
and validates, filters, and normalizes complete scans before returning results.

[source]: https://github.com/handsomeboy65/dsh-task-hub/blob/053282f1fe1a79bb257439926c3af06b3ef5f0a1/lib/tapd.js
[license]: ./dsh-task-hub.LICENSE
