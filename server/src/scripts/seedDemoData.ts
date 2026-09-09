/**
 * Loads synthetic outlet master data so the app can be exercised before the real
 * Google Sheet is wired up. All values are fabricated - no real store or contact
 * data. A real sync overwrites this table completely.
 *
 *   npm run seed:demo --workspace server
 */
import { migrate } from '../db/index.js';
import { outletRepo } from '../repos/outletRepo.js';
import { nowIso } from '../utils/time.js';

migrate();

const CITIES = [
  ['Dhanbad', 'Sub Zero'], ['Bengaluru', 'CoolTech'], ['Kharagpur', 'Sub Zero'],
  ['Mumbai', 'FrostLine'], ['Pune', 'CoolTech'], ['Ahmedabad', 'FrostLine'],
  ['Bahadurgarh', 'Sub Zero'], ['Mangalore', 'CoolTech'], ['West Delhi', 'FrostLine'],
  ['Hyderabad', 'Sub Zero'],
];

const MODES = ['Owned', 'Franchise', 'Partner'];

const outlets = CITIES.flatMap(([city, vendor], cityIndex) =>
  Array.from({ length: 4 }, (_, index) => {
    const serial = cityIndex * 4 + index + 1;
    return {
      outletId: `ES${String(serial).padStart(3, '0')}`,
      storeName: `SS ${city} Sector ${index + 1} ES${serial}`,
      city,
      mode: MODES[serial % MODES.length],
      vendor,
      pocName: `Demo POC ${serial}`,
      pocContact: `90000${String(10000 + serial).slice(-5)}`,
    };
  }),
);

const count = outletRepo.replaceAll(outlets, nowIso());
console.log(`Seeded ${count} synthetic outlets across ${CITIES.length} cities.`);
console.log('Replace with real data by configuring the Google Sheet and pressing Sync Now.');
