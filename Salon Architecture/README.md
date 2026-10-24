# Beauty salon and parlour platform — architecture package

**Version 1.0 · 24 October 2026 · Design specification, not an implemented or certified system**

This is a new, salon-specific platform informed by the supplied MediFlow architecture export. No product name is assumed. The design supports independent salons and multi-branch businesses in Pakistan, with customer self-booking, staff-assisted bookings, walk-ins, multi-service visits, live operations, payments, and mandatory Gemini integration.

Read these documents in order:

1. [MediFlow analysis and reuse decisions](01-MEDIFLOW-ANALYSIS.md) — source evidence, reconstructed architecture, limitations, and what carries forward.
2. [Complete platform architecture](02-PLATFORM-ARCHITECTURE.md) — product scope, roles, components, workflows, scheduling, queues, Gemini, and security.
3. [Database and API contracts](03-DATA-AND-API-CONTRACTS.md) — entities, constraints, state machines, transaction algorithms, endpoints, examples, and events.
4. [Deployment and implementation plan](04-DELIVERY-AND-OPERATIONS.md) — AWS topology, environments, recovery, monitoring, testing, delivery milestones, and launch gates.

The core decision is to treat a visit as a **scheduled sequence of service steps**, each consuming qualified staff and physical resources for defined intervals. A queue coordinates actual arrivals and service execution; it does not replace the reservation calendar.

The initial production release includes the complete operational core, a staff-facing Gemini booking assistant, and grounded owner summaries. Advanced group-event optimisation, native mobile apps, consumer AI chat, and full payroll are explicitly later additions. Implementation phases are sequenced delivery work, not substitutes for production safeguards.

The package contains design contracts and illustrative pseudocode/SQL. Developers must implement migrations, OpenAPI schemas, applications, infrastructure, and tests against these contracts. Neither MediFlow's original application nor the proposed salon platform was executed during this architecture review.
