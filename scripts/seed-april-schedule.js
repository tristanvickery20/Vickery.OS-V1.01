// scripts/seed-april-schedule.js
// Seeds 2-3 scheduled bookings per day for April 2026.
// All share phone 4096580797. All other fields are unique.
// Run: node scripts/seed-april-schedule.js

const { getSheetsClient } = require("../lib/sheets");

const SHEET_ID = process.env.CRM_SHEET_ID;
const PHONE    = "4096580797";

const TECH_IDS = [
  "30739ce8-d29e-4a13-91ba-7bc9c0802f46", // Tristan Vickery
  "f5029e0f-8ae4-4072-94b7-4161e07df89d", // Gavin Vickery
];

const NAMES = [
  "James Fontenot", "Patricia Broussard", "Kevin Guidry", "Sandra Thibodaux",
  "Michael Meaux", "Laura Arceneaux", "David Landry", "Donna Duhon",
  "Robert Boudreaux", "Ashley Trahan", "William Hebert", "Amanda Credeur",
  "Thomas Menard", "Melissa Guillory", "Charles Richard", "Stephanie Fontenot",
  "Daniel Dupuis", "Rebecca Mouton", "Matthew Leger", "Laura Benoit",
  "Anthony Chenevert", "Rachel Thibodeaux", "Mark Gaspard", "Sharon Pontiff",
  "Donald Robicheaux", "Virginia Comeaux", "Steven Gautreau", "Cynthia Prejean",
  "Paul Theriot", "Kathleen Rosamond", "Andrew Sagrera", "Christine Desormeaux",
  "Kenneth Breaux", "Deborah Blanchard", "Joshua Fontenot", "Amy Thibaut",
  "Gary Hebert", "Sandra LeBlanc", "Jason Fusilier", "Kimberly Begnaud",
  "Brian Chauvin", "Carol Romero", "Edward Menard", "Michelle Doucet",
  "Ronald Broussard", "Lisa Lafleur", "Christopher Guillory", "Samantha Guidry",
  "Ryan Blanchard", "Nicole Theriot", "Brandon Trahan", "Tamara Richard",
  "Samuel Arceneaux", "Tiffany Hebert", "Zachary Boudreaux", "Megan LeBlanc",
  "Tyler Fontenot", "Brittany Thibodaux", "Justin Leger", "Kayla Mouton",
  "Austin Credeur", "Haley Duhon", "Nathan Prejean", "Madison Broussard",
  "Hunter Chauvin", "Alexis Guidry", "Caleb Richard", "Shelby Meaux",
  "Ethan Begnaud", "Hannah Comeaux", "Connor Gautreau", "Abigail Breaux",
  "Dylan Desormeaux", "Savannah Pontiff", "Isaac Lafleur", "Chloe Sagrera",
  "Liam Arceneaux", "Emma Blanchard", "Noah Doucet", "Olivia Theriot",
];

const ADDRESSES = [
  "412 W Park Ave, Orange, TX 77630",
  "1804 16th St, Orange, TX 77630",
  "875 Green Ave, Orange, TX 77630",
  "3302 Division Ave, Orange, TX 77630",
  "620 N 5th St, Orange, TX 77630",
  "2109 Simmons Dr, Orange, TX 77630",
  "514 E Lutcher Dr, Orange, TX 77630",
  "1125 Western Ave, Orange, TX 77630",
  "748 Pine St, Orange, TX 77630",
  "3015 MacArthur Dr, Orange, TX 77630",
  "905 MLK Jr Blvd, Vidor, TX 77662",
  "215 Railroad Ave, Vidor, TX 77662",
  "1440 Spurlock Rd, Vidor, TX 77662",
  "332 Dewitt Ave, Vidor, TX 77662",
  "517 North St, Vidor, TX 77662",
  "2208 Old Hwy 90, Vidor, TX 77662",
  "114 Magnolia St, Vidor, TX 77662",
  "740 Ave B, Vidor, TX 77662",
  "4420 Calder Ave, Beaumont, TX 77706",
  "1811 College St, Beaumont, TX 77701",
  "930 Cardinal Dr, Beaumont, TX 77706",
  "2745 Washington Blvd, Beaumont, TX 77705",
  "665 Pine St, Beaumont, TX 77701",
  "3210 Gladys Ave, Beaumont, TX 77702",
  "820 S 4th St, Beaumont, TX 77701",
  "1415 Broadway St, Beaumont, TX 77701",
  "5012 Phelan Blvd, Beaumont, TX 77706",
  "219 Harriot Ave, Port Arthur, TX 77640",
  "1630 9th Ave, Port Arthur, TX 77640",
  "820 Houston Ave, Port Arthur, TX 77640",
  "3309 Memorial Blvd, Port Arthur, TX 77640",
  "411 Cultural Center Dr, Port Arthur, TX 77642",
  "916 42nd St, Port Arthur, TX 77640",
  "2230 Lakeview Dr, Bridge City, TX 77611",
  "715 Texas Ave, Bridge City, TX 77611",
  "1022 Twin City Hwy, Bridge City, TX 77611",
  "3418 Gulfway Dr, Groves, TX 77619",
  "514 39th St, Groves, TX 77619",
  "1106 Port Neches Ave, Groves, TX 77619",
  "220 S Twin City Hwy, Nederland, TX 77627",
  "845 Nederland Ave, Nederland, TX 77627",
  "1712 Boston Ave, Nederland, TX 77627",
  "422 US Hwy 96, Silsbee, TX 77656",
  "1105 Hwy 327 W, Silsbee, TX 77656",
  "715 S 5th St, Silsbee, TX 77656",
  "330 N Wheeler St, Jasper, TX 75951",
  "1214 Lamar St, Jasper, TX 75951",
  "2218 S Main St, Jasper, TX 75951",
  "510 E Commerce St, Kountze, TX 77625",
  "1340 US Hwy 69, Woodville, TX 75979",
  "415 W Sabine St, Kirbyville, TX 75956",
  "222 Calloway Ave, Pinehurst, TX 77630",
  "1518 FM 1006, Orange, TX 77632",
  "4201 N 16th St, Orange, TX 77630",
  "755 MLK Pkwy, Beaumont, TX 77701",
  "2840 Dowlen Rd, Beaumont, TX 77706",
  "1610 Concord Rd, Beaumont, TX 77703",
  "388 Lakewood Dr, Groves, TX 77619",
  "906 Ridgewood Rd, Vidor, TX 77662",
  "1724 Cedar Bayou Rd, Orange, TX 77630",
  "3205 Harrison Ave, Groves, TX 77619",
  "812 Jade Ave, Vidor, TX 77662",
  "2410 Jimmy Johnson Blvd, Port Arthur, TX 77642",
  "130 Decker Dr, Orange, TX 77630",
  "4715 Hwy 87, Orange, TX 77632",
  "1012 Kerr Ave, Beaumont, TX 77706",
  "525 N 11th St, Beaumont, TX 77702",
  "2104 FM 105, Vidor, TX 77662",
  "817 Turtle Creek Dr, Beaumont, TX 77706",
  "3316 Bigner Rd, Beaumont, TX 77706",
  "1419 Ave J, Port Arthur, TX 77640",
  "635 Belvedere Dr, Orange, TX 77630",
  "2022 MLK Dr, Vidor, TX 77662",
  "444 Roundbunch Rd, Bridge City, TX 77611",
  "1100 N Main St, Vidor, TX 77662",
  "317 Meadowbrook Dr, Orange, TX 77630",
  "2608 32nd St, Port Arthur, TX 77640",
  "505 Oriole Ave, Port Neches, TX 77651",
  "1815 Port Neches Ave, Port Neches, TX 77651",
];

const JOB_TYPES = [
  "panel_upgrade", "outlet_install", "ceiling_fan", "ev_charger",
  "generator", "lighting", "wiring_repair", "service_call",
  "meter_base", "breaker_replace", "surge_protection", "smoke_detectors",
  "bathroom_fan", "outdoor_lighting", "recessed_lights", "transfer_switch",
];

const PRICES = [250, 350, 450, 550, 650, 750, 875, 1200, 1500, 2500, 3200, 4500];
const DURATIONS = [60, 90, 120, 180, 240, 300];

const MORNING_TIMES = ["08:00:00", "08:30:00", "09:00:00", "09:30:00", "10:00:00", "10:30:00"];
const AFTERNOON_TIMES = ["12:00:00", "12:30:00", "13:00:00", "13:30:00", "14:00:00", "14:30:00", "15:00:00"];

function pick(arr, idx) { return arr[idx % arr.length]; }

// Generate 2–3 bookings per day, April 1–30 2026
function buildBookings() {
  const bookings = [];
  let idx = 0;

  for (let day = 1; day <= 30; day++) {
    const yyyy = "2026";
    const mm = "04";
    const dd = String(day).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const dow = new Date(`${dateStr}T12:00:00`).getDay(); // 0=Sun
    if (dow === 0) continue; // skip Sundays (optional — comment out to include)

    const count = (idx % 3 === 0) ? 3 : 2; // 2 or 3 per day, cycling

    for (let slot = 0; slot < count; slot++) {
      const isAfternoon = slot >= 1; // first booking Morning, rest Afternoon
      const timeArr = isAfternoon ? AFTERNOON_TIMES : MORNING_TIMES;
      const time = pick(timeArr, slot + day);
      const block = isAfternoon ? "Afternoon" : "Morning";

      const name = pick(NAMES, idx);
      const addr = pick(ADDRESSES, idx);
      const jobType = pick(JOB_TYPES, idx);
      const price = pick(PRICES, idx + slot);
      const duration = pick(DURATIONS, idx + slot);
      const techId = pick(TECH_IDS, idx + slot);

      const bkId = `BK-APR26-${String(idx + 1).padStart(3, "0")}`;
      const qsId = `QS-APR26-${String(idx + 1).padStart(3, "0")}`;

      bookings.push({
        booking_id: bkId,
        quote_id: qsId,
        created_at: `2026-03-${String(Math.max(1, day - 5)).padStart(2, "0")}T10:00:00.000Z`,
        scheduled_datetime: `${dateStr}T${time}`,
        duration_minutes: String(duration),
        address: addr,
        customer_name: name,
        status: "confirmed",
        schedule_block: block,
        job_type_id: jobType,
        final_price: String(price),
        phone: PHONE,
        email: "",
        block_allocated_minutes: String(duration),
        booking_group_id: "",
        is_continuation: "false",
        assigned_tech_id: techId,
        lat: "",
        lng: "",
        assigned_tech_ids: techId,
      });

      idx++;
    }
  }
  return bookings;
}

async function main() {
  console.log("\n📅 April 2026 Schedule Seed");
  console.log("═══════════════════════════════");

  const sheets = await getSheetsClient();

  // Get Bookings headers
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Bookings!A1:1",
  });
  const headers = (resp.data.values && resp.data.values[0]) || [];
  if (!headers.length) { console.error("❌ Could not read Bookings headers"); process.exit(1); }

  const bookings = buildBookings();
  const rows = bookings.map(b => headers.map(h => String(b[h] ?? "")));

  console.log(`\nInserting ${rows.length} bookings across April 2026...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Bookings!A:A",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { majorDimension: "ROWS", values: rows },
  });

  // Summary
  const byDay = {};
  bookings.forEach(b => {
    const d = b.scheduled_datetime.slice(0, 10);
    byDay[d] = (byDay[d] || 0) + 1;
  });
  const days = Object.keys(byDay).sort();
  console.log(`\n✅ Done! ${rows.length} bookings seeded.`);
  console.log(`   April days covered: ${days.length}/30`);
  console.log(`   Range: ${days[0]} → ${days[days.length - 1]}`);
  console.log(`   Techs: Tristan Vickery & Gavin Vickery`);
  console.log(`   All phone: ${PHONE}\n`);
}

main().catch(err => {
  console.error("\n❌ Seed failed:", err.message);
  process.exit(1);
});
