import { hash as passwordHash } from 'argon2';
import { db, transaction, one, TENANT, BRANCH, SECOND_BRANCH } from './db.ts';
import {
  id,
  at,
  localDate,
  addMinutes,
  hash,
  token,
  reserve,
  type Scope,
  type Plan,
  type PlanStep,
} from './domain.ts';
export const DEMO_OWNER = '33333333-3333-4333-8333-333333333333';
export const DEMO_RECEPTION = '33333333-3333-4333-8333-333333333334';
export const DEMO_PRO = '33333333-3333-4333-8333-333333333335';
export const DEMO_CUSTOMER = '33333333-3333-4333-8333-333333333336';
export async function seed() {
  if (await one(db, 'SELECT id FROM tenants LIMIT 1')) return;
  if (process.env.NODE_ENV === 'production')
    throw new Error('Sample data cannot be seeded in production.');
  await transaction(async (tx) => {
    await tx.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [TENANT, 'Aurelle Studio']);
    for (const [bid, name, address] of [
      [BRANCH, 'Gulberg Studio', '24-B, MM Alam Road, Gulberg III, Lahore'],
      [SECOND_BRANCH, 'DHA Studio', 'Sector Y, Phase 3, DHA, Lahore'],
    ])
      await tx.query('INSERT INTO branches(tenant_id,id,name,data) VALUES($1,$2,$3,$4)', [
        TENANT,
        bid,
        name,
        {
          address,
          city: 'Lahore',
          timezone: 'Asia/Karachi',
          currency: 'PKR',
          open: '10:00',
          close: '20:00',
          closed_days: [],
          phone: '+92 300 1234567',
          tax_rate: 0,
          cancellation_hours: 12,
          deposit_required: false,
        },
      ]);
    const password = await passwordHash('Aurelle-demo-2026!');
    for (const [aid, name, role] of [
      [DEMO_OWNER, 'Ayesha Khan', 'owner'],
      [DEMO_RECEPTION, 'Sara Ali', 'receptionist'],
      [DEMO_PRO, 'Meher Ahmed', 'professional'],
    ])
      await tx.query(
        'INSERT INTO accounts(id,tenant_id,branch_id,name,email,password_hash,role,adult) VALUES($1,$2,$3,$4,$5,$6,$7,true)',
        [aid, TENANT, BRANCH, name, `${role}@aurelle.demo`, password, role],
      );
    const services = [
      [
        'Signature haircut',
        'Hair',
        250000,
        45,
        'chair',
        'A considered cut, tailored to your texture, face shape, and everyday routine.',
      ],
      [
        'Colour & gloss',
        'Hair',
        650000,
        100,
        'chair',
        'Dimensional colour with a high-shine, nourishing finish.',
      ],
      [
        'Classic blow-dry',
        'Hair',
        180000,
        30,
        'chair',
        'A smooth, polished finish with just the right movement.',
      ],
      [
        'Signature facial',
        'Skin',
        450000,
        60,
        'room',
        'Cleanse, exfoliate, and replenish with our restorative skin ritual.',
      ],
      [
        'Classic manicure',
        'Nails',
        150000,
        40,
        'nail',
        'Thoughtful nail care, shaping, and your choice of polish.',
      ],
      [
        'Gel pedicure',
        'Nails',
        280000,
        55,
        'nail',
        'A restorative foot ritual finished with long-lasting gel colour.',
      ],
      [
        'Occasion makeup',
        'Makeup',
        800000,
        75,
        'room',
        'A beautifully balanced look, created for your special occasion.',
      ],
      [
        'Brow shaping',
        'Skin',
        70000,
        15,
        'room',
        'Soft definition and a shape that feels like you.',
      ],
    ];
    const pros = [
      {
        name: 'Meher Ahmed',
        title: 'Senior hair stylist',
        skills: ['Hair'],
        initials: 'MA',
        color: 'sage',
        commission: 15,
      },
      {
        name: 'Sana Malik',
        title: 'Hair & colour specialist',
        skills: ['Hair'],
        initials: 'SM',
        color: 'peach',
        commission: 15,
      },
      {
        name: 'Noor Fatima',
        title: 'Skin & makeup artist',
        skills: ['Skin', 'Makeup'],
        initials: 'NF',
        color: 'lavender',
        commission: 20,
      },
      {
        name: 'Hira Shah',
        title: 'Nail specialist',
        skills: ['Nails'],
        initials: 'HS',
        color: 'sand',
        commission: 15,
      },
    ];
    for (const bid of [BRANCH, SECOND_BRANCH]) {
      const serviceRows: any[] = [];
      const proRows: any[] = [];
      const resourceRows: any[] = [];
      for (const [name, category, price, duration, resource, description] of services) {
        const sid = id();
        const phases =
          name === 'Colour & gloss'
            ? [
                { name: 'Colour application', minutes: 30, staff: true, resource: 'chair' },
                { name: 'Colour processing', minutes: 35, staff: false, resource: 'chair' },
                { name: 'Rinse & finish', minutes: 25, staff: true, resource: 'chair' },
                { name: 'Station reset', minutes: 10, staff: false, resource: 'chair' },
              ]
            : [
                {
                  name: String(name),
                  minutes: Number(duration) - 5,
                  staff: true,
                  resource: String(resource),
                },
                { name: 'Station reset', minutes: 5, staff: false, resource: String(resource) },
              ];
        const row = {
          id: sid,
          name,
          category,
          price_minor: String(price),
          duration,
          data: {
            resource,
            description,
            phases,
            preparation: 'Please arrive 10 minutes before your appointment.',
            commission: 15,
          },
        };
        await tx.query(
          'INSERT INTO services(tenant_id,branch_id,id,name,category,price_minor,duration,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [TENANT, bid, sid, name, category, price, duration, row.data],
        );
        serviceRows.push(row);
      }
      for (const [index, p] of pros.entries()) {
        const pid = id(),
          data = {
            ...p,
            start: '10:00',
            end: '20:00',
            breaks: [{ start: '14:00', end: '14:30' }],
            off_days: [],
            account_id: index === 0 && bid === BRANCH ? DEMO_PRO : null,
          };
        await tx.query(
          'INSERT INTO professionals(tenant_id,branch_id,id,name,title,data) VALUES($1,$2,$3,$4,$5,$6)',
          [TENANT, bid, pid, p.name, p.title, data],
        );
        await tx.query(
          "INSERT INTO assets(tenant_id,branch_id,id,kind,name) VALUES($1,$2,$3,'professional',$4)",
          [TENANT, bid, pid, p.name],
        );
        proRows.push({ id: pid, ...p });
      }
      for (const [name, type] of [
        ['Styling chair 1', 'chair'],
        ['Styling chair 2', 'chair'],
        ['Treatment room 1', 'room'],
        ['Treatment room 2', 'room'],
        ['Nail station 1', 'nail'],
      ]) {
        const rid = id();
        await tx.query(
          "INSERT INTO assets(tenant_id,branch_id,id,kind,name,resource_type) VALUES($1,$2,$3,'resource',$4,$5)",
          [TENANT, bid, rid, name, type],
        );
        resourceRows.push({ id: rid, name, type });
      }
      const names = [
        'Zara Hassan',
        'Amina Sheikh',
        'Fatima Raza',
        'Mahnoor Ali',
        'Eman Tariq',
        'Areeba Khan',
        'Sadia Ahmed',
        'Iqra Noor',
        'Hania Qureshi',
        'Mariam Asif',
        'Anaya Malik',
        'Rida Shah',
        'Laiba Farooq',
        'Nimra Saeed',
        'Ayesha Rehman',
        'Sana Javed',
      ];
      const customerRows = [];
      for (const [i, name] of names.entries()) {
        const cid = id();
        const phone = `+923${bid === BRANCH ? '00' : '01'}${String(1000000 + i).padStart(7, '0')}`;
        await tx.query(
          'INSERT INTO customers(tenant_id,branch_id,id,name,phone,data) VALUES($1,$2,$3,$4,$5,$6)',
          [
            TENANT,
            bid,
            cid,
            name,
            phone,
            {
              email: `client${i + 1}@example.com`,
              marketing: false,
              tags: i % 4 === 0 ? ['Regular'] : [],
              preferences: '',
              consents: { service: true, marketing: false, photos: false },
            },
          ],
        );
        await tx.query(
          "INSERT INTO assets(tenant_id,branch_id,id,kind,name) VALUES($1,$2,$3,'recipient',$4)",
          [TENANT, bid, cid, 'Recipient'],
        );
        customerRows.push({ id: cid, name, phone });
      }
      if (bid === BRANCH)
        await tx.query(
          "INSERT INTO accounts(id,tenant_id,branch_id,name,role,customer_id,adult) VALUES($1,$2,$3,$4,'customer',$5,false)",
          [DEMO_CUSTOMER, TENANT, bid, customerRows[0].name, customerRows[0].id],
        );
      const scope: Scope = { tenant: TENANT, branch: bid, actor: DEMO_OWNER, role: 'owner' };
      // Synthetic history and current-day appointments; no claimed business results.
      for (let dayOffset = -6; dayOffset <= 1; dayOffset++) {
        const date = localDate(new Date(Date.now() + dayOffset * 86400000));
        const schedule = [
          { svc: 0, p: 0, h: 10, m: 0 },
          { svc: 4, p: 3, h: 10, m: 0 },
          { svc: 3, p: 2, h: 10, m: 30 },
          { svc: 2, p: 1, h: 10, m: 30 },
          { svc: 0, p: 0, h: 11, m: 15 },
          { svc: 5, p: 3, h: 11, m: 15 },
          { svc: 6, p: 2, h: 12, m: 0 },
          { svc: 1, p: 1, h: 12, m: 0 },
          { svc: 0, p: 0, h: 12, m: 30 },
          { svc: 4, p: 3, h: 13, m: 0 },
          { svc: 0, p: 0, h: 15, m: 0 },
          { svc: 3, p: 2, h: 15, m: 0 },
          { svc: 2, p: 1, h: 15, m: 30 },
          { svc: 5, p: 3, h: 16, m: 0 },
          { svc: 6, p: 2, h: 17, m: 0 },
          { svc: 0, p: 0, h: 17, m: 30 },
        ];
        for (const [index, entry] of schedule.entries()) {
          const svc = serviceRows[entry.svc],
            pro = proRows[entry.p],
            customer = customerRows[index];
          let cursor = at(
            date,
            `${String(entry.h).padStart(2, '0')}:${String(entry.m).padStart(2, '0')}`,
          );
          const start = cursor;
          const resource = resourceRows.find(
            (r) => r.type === svc.data.resource && (entry.p !== 1 || r.name === 'Styling chair 2'),
          )!;
          const steps: PlanStep[] = svc.data.phases.map((phase: any) => {
            const end = addMinutes(cursor, phase.minutes);
            const st = {
              service_id: svc.id,
              service_name: svc.name,
              phase: phase.name,
              duration: phase.minutes,
              professional_id: pro.id,
              professional_name: pro.name,
              resource_id: resource.id,
              resource_name: resource.name,
              staff: phase.staff,
              starts_at: cursor.toISOString(),
              ends_at: end.toISOString(),
              price_minor: svc.price_minor,
              category: svc.category,
            };
            cursor = end;
            return st;
          });
          const plan: Plan = {
            steps,
            starts_at: start.toISOString(),
            ends_at: cursor.toISOString(),
            total_minor: svc.price_minor,
            service_ids: [svc.id],
            policy_version: 1,
          };
          const bookingId = id(),
            pass = token();
          const historical = dayOffset < 0;
          const state = historical ? 'FULFILLED' : 'CONFIRMED';
          const current = dayOffset === 0;
          const arrived = current && index < 6;
          const active = current && (index === 4 || index === 5);
          const done = current && index < 4;
          const ref = `AU-${date.replaceAll('-', '').slice(2)}-${String(index + 1).padStart(3, '0')}`;
          await tx.query(
            'INSERT INTO bookings(tenant_id,branch_id,id,customer_id,reference,source,status,starts_at,ends_at,total_minor,plan,pass_hash,pass_token,arrived_at,visit_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
            [
              TENANT,
              bid,
              bookingId,
              customer.id,
              `${bid === BRANCH ? '' : 'D-'}${ref}`,
              index % 5 === 0 ? 'walk_in' : 'staff',
              done ? 'FULFILLED' : state,
              start,
              cursor,
              svc.price_minor,
              plan,
              hash(pass),
              pass,
              arrived || historical ? start : null,
              historical || done ? 'CLOSED' : active ? 'IN_SERVICE' : arrived ? 'WAITING' : null,
            ],
          );
          if (!historical && !done)
            await reserve(tx, scope, bookingId, customer.id, plan, 'confirmed');
          for (const [si, st] of steps.entries()) {
            const stepId = id();
            const stepState =
              historical || done
                ? 'COMPLETED'
                : active && si === 0
                  ? 'ACTIVE'
                  : arrived && si === 0
                    ? 'READY'
                    : 'PLANNED';
            await tx.query(
              'INSERT INTO steps(tenant_id,branch_id,id,booking_id,sequence,state,data,actual_start,actual_end) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                TENANT,
                bid,
                stepId,
                bookingId,
                si,
                stepState,
                st,
                stepState === 'ACTIVE' || stepState === 'COMPLETED' ? st.starts_at : null,
                stepState === 'COMPLETED' ? st.ends_at : null,
              ],
            );
            if (stepState === 'ACTIVE')
              for (const asset of [st.resource_id, ...(st.staff ? [st.professional_id] : [])])
                await tx.query(
                  'INSERT INTO occupancies(tenant_id,id,asset_id,step_id) VALUES($1,$2,$3,$4)',
                  [TENANT, id(), asset, stepId],
                );
          }
          if (historical || done) {
            const invoiceId = id(),
              paymentId = id();
            const snapshot = {
              reference: ref,
              customer_name: customer.name,
              lines: [{ name: svc.name, amount_minor: svc.price_minor }],
              total_minor: svc.price_minor,
              currency: 'PKR',
              branch_name: bid === BRANCH ? 'Gulberg Studio' : 'DHA Studio',
            };
            await tx.query(
              'INSERT INTO invoices(tenant_id,branch_id,id,booking_id,number,total_minor,snapshot,issued_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [
                TENANT,
                bid,
                invoiceId,
                bookingId,
                `INV-${invoiceId.slice(0, 8).toUpperCase()}`,
                svc.price_minor,
                snapshot,
                cursor,
              ],
            );
            await tx.query(
              "INSERT INTO payments(tenant_id,branch_id,id,invoice_id,amount_minor,tender,created_at) VALUES($1,$2,$3,$4,$5,'cash',$6)",
              [TENANT, bid, paymentId, invoiceId, svc.price_minor, cursor],
            );
            const receipt = {
              ...snapshot,
              invoice_id: invoiceId,
              payment_id: paymentId,
              paid_minor: svc.price_minor,
              tender: 'cash',
              issued_at: cursor.toISOString(),
            };
            await tx.query(
              'INSERT INTO receipts(tenant_id,id,invoice_id,payment_id,snapshot,checksum,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [TENANT, id(), invoiceId, paymentId, receipt, hash(JSON.stringify(receipt)), cursor],
            );
            for (const [account, amount] of [
              ['cash', svc.price_minor],
              ['service_revenue', String(-Number(svc.price_minor))],
            ])
              await tx.query(
                'INSERT INTO ledger_entries(tenant_id,id,transaction_id,account,amount_minor,created_at) VALUES($1,$2,$3,$4,$5,$6)',
                [TENANT, id(), paymentId, account, amount, cursor],
              );
          }
        }
      }
      for (const [name, category, unit, on_hand, reorder, price] of [
        ['Hydrating shampoo', 'Hair care', 'bottles', 18, 5, 320000],
        ['Colour developer 6%', 'Colour', 'bottles', 3, 5, 180000],
        ['Nourishing facial serum', 'Skin care', 'bottles', 8, 4, 450000],
        ['Gel polish · Rosewood', 'Nail care', 'bottles', 2, 3, 220000],
        ['Cotton pads', 'Essentials', 'packs', 24, 10, 35000],
        ['Styling cream', 'Hair care', 'jars', 12, 4, 260000],
      ])
        await tx.query(
          'INSERT INTO products(tenant_id,branch_id,id,name,category,unit,on_hand,reorder_at,price_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [TENANT, bid, id(), name, category, unit, on_hand, reorder, price],
        );
    }
  });
}
