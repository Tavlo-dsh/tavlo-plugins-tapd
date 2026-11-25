# Arc UI attribution

The components under `ui/arc/` are adapted from the official free registry (`meta.tier: free`), retrieved 2026-11-20:

- [Input](https://uiarc.dev/r/input.json)
- [Select](https://uiarc.dev/r/select.json)
- [Accordion](https://uiarc.dev/r/accordion.json)
- [Arc motion tokens](https://uiarc.dev/r/arc-motion-tokens.json)

Arc UI licenses the free registry source under [MIT](https://uiarc.dev/license#free). The copyright notice and full terms are in [uiarc-MIT.txt](./uiarc-MIT.txt). No Arc Pro code or preview assets are included.

Tavlo adapted the local CSS modules to the DSH theme and allows externally labeled fields. Select renders one accessible label, with the upstream directional animation applied on entry. Accordion supports individual disclosure sections with an optional annotation; its closed content is inert while it animates. The packaged browser bundle includes third-party dependency notices in `lib/client.js.LEGAL.txt`.
