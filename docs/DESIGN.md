# Orbit interface system

The premium redesign uses a midnight navy foundation, soft neutral surfaces and an electric blue accent. Restrained semantic green, amber and red identify recorded states. Typography, spacing, borders, tables and forms share the tokens in `src/app/globals.css`.

Light and dark appearances use the same semantic tokens. The selected appearance is stored as `orbit-theme`; first render initializes the document before hydration, and controls synchronize across tabs. Motion is brief and respects reduced-motion preferences.

Client workspaces focus on pipeline, outreach, conversations and their own integrations. Platform administrators land in a separate Command Centre with eleven navigation sections, aggregate analytics, website management and account/subscription controls. Opening a client workspace requires the existing administrator authorization; the new monitoring endpoints are read-only and retain tenant restrictions.

`charts.tsx` supplies keyboard-focusable chart points, metric selection, tooltips and animated count transitions. `primitives.tsx` supplies shared forms, skeletons, approval dialogs, live message previews and focus-managed lead drawers. Empty states represent absent records; unavailable provider measurements remain unavailable.

All editable features continue to call the existing APIs. Website inspection and automation monitoring add bounded, sanitized read queries over the existing schema. No backend business workflow or database schema was replaced for this visual redesign.
