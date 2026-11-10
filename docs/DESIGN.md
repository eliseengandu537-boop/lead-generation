# Monettic interface system

The premium redesign uses a midnight navy foundation, soft neutral surfaces and an electric blue accent. Restrained semantic green, amber and red identify recorded states. Typography, spacing, borders, tables and forms share the tokens in `src/app/globals.css`.

Light and dark appearances use the same semantic tokens. The selected appearance is stored as `orbit-theme`; first render initializes the document before hydration, and controls synchronize across tabs. Motion is brief and respects reduced-motion preferences.

Clients sign into a dedicated results portal with a horizontal navigation and seven pages: Dashboard, Your leads, Your campaigns, Conversations, Results, Your website and Updates. The portal displays business results and message previews without integration settings, workflow controls, campaign approval or sending actions, team administration, billing administration, or workspace creation. It explicitly distinguishes sample results, pending setup, active campaigns and unsupported website visitor tracking.

Platform administrators land in a separate Command Centre with eleven navigation sections, aggregate analytics, website management and account/subscription controls. Administrators can open an operational business workspace for configuration and outreach management. Client memberships, including legacy CLIENT_ADMIN and SALES_MEMBER roles, cannot access operational APIs. The client portal uses a separate tenant-authorized endpoint with an explicit response field selection.

`charts.tsx` supplies keyboard-focusable chart points, metric selection, tooltips and animated count transitions. `primitives.tsx` supplies shared forms, skeletons, approval dialogs, live message previews and focus-managed lead drawers. Empty states represent absent records; unavailable provider measurements remain unavailable.

Operator edits use the operational APIs with platform administrator authorization. The client portal has a separate response model with explicit business-facing fields and no mutation controls. The database schema and existing campaign sending requirements remain unchanged.
