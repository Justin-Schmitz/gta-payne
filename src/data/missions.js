import { curb, park, center, inter, MANSION } from '../world/city.js';

export const BOSSES = {
  cinelli: { name: 'Marco Cinelli', zone: 'Downtown', color: '#d9b24c' },
  crows: { name: 'Big Dell', zone: 'Eastside', color: '#7c4dff' },
  mal: { name: 'Sister Mal', zone: 'Westside', color: '#ff5e5e' },
};

/**
 * Campaign: 14 jobs, each a chain of objective steps (see src/systems/missions.js for every step type).
 *
 *  id      stable save id (saves store the ids of finished missions). m1-m10 are the originals, m11-m14 were added later.
 *  order   play order; the chain runs by `order`, not by id, so newer missions can sit between older ones.
 *  source  'phone' (default: answer the boss's ringing payphone) or 'page' (the boss pages you while you free-roam and the
 *          mission starts by itself; `page` is the pager line). The payphone chain skips paged missions.
 *
 * Spoken lines (intro, outro, page, step message / doneMessage, wave messages) get stable voice ids, see VOICES.md.
 * Mini-bosses and bosses: a `kill` / `ambush` spawn spec with `miniBoss: true` (or `boss: true`), `name`, `hp` (before difficulty),
 * `weapon`, `scale`, `tint` and a `line` (spoken a moment after they appear, id `mX.stepN.miniK`). A spawn spec in an `ambush` may have its own
 * `at` (scatter there). `collect` items may carry `guards` (same spec, incl. a `line`). A step with a boss may carry `bossScript`
 * (hp-fraction phases: say / weapon / charge / guards), `grenades` and `bounds: 'mansion'`, see Missions.tickBoss; the mission lists
 * the phase lines again in `bossLines` ([{id, who, text}]) so `npm run voice-lines` can export them.
 * All content here is original.
 */
/** Julpie's spoken lines (the finale in m10): appearance, the 60% and 30% phases, and the death rattle. */
const JULPIE_HELLO = "WELCOME to Julpie's House! Shoes off, weapons ON! Mind the pool. It's full of money. And piranhas. Mostly money!";
const JULPIE_P1 = "Oh, you want the BIG toys? Fine! Bring the boys! All of them! Even Gary! GARY, PUT DOWN THE SANDWICH!";
const JULPIE_P2 = "That's IT! Nobody scuffs the patio and lives! I'm going to carve you like a honey-glazed HAM! Hold still!";
const JULPIE_DEAD = "My... beautiful... house... Who's going to water the hedges... Tell Gary... the sandwich... was... mine...";

export const MISSIONS = [
  {
    id: 'm1', order: 1, boss: 'cinelli', title: 'TAXI DRIVER', reward: 5000,
    intro: "New face. Good. My cousin Tony just got off the train at Central Station and he doesn't like waiting. Grab a cab, run him down to Pier 9, and don't scratch him. He bruises like a peach.",
    vehicleLost: 'The taxi is wrecked. Tony is not impressed.',
    steps: [
      { type: 'steal', vehicle: 'taxi', spawn: park(5, 3, 'n', 0.4), text: 'Get the TAXI parked near Central Station.' },
      { type: 'goto', at: park(5, 2, 's', 0.5), radius: 7, inVehicle: 'mission', text: 'Pick up Tony outside Central Station.', doneMessage: 'Pier 9, pal. And keep it smooth, I just ate a whole calzone.', doneWho: 'Tony' },
      { type: 'goto', at: park(5, 9, 's', 0.5), radius: 7, inVehicle: 'mission', text: 'Take Tony to Pier 9. Shake the purple cars!',
        message: 'Why is that purple car so close? Pal. PAL. Those are Hollow Crows. They heard a Cinelli was in town!', who: 'Tony',
        chasers: { n: 2, vehicle: ['sedan', 'compact'], gang: 'crows', after: 5 } },
    ],
    outro: "Tony says you drive like somebody's grandmother, and that the purple cars were your fault. From him that's a compliment. Here's your cut.",
  },
  {
    id: 'm2', order: 2, boss: 'cinelli', title: 'SCRAP RUN', reward: 8000,
    intro: "Some joker from the Hollow Crows parks his pretty red sports car at the Marina every night. Steal it and get it to the crusher at Harlow Scrap before it's reported. And don't touch the radio. He has terrible taste.",
    vehicleLost: 'You wrecked the car. The crusher wanted it in one piece.',
    steps: [
      { type: 'steal', vehicle: 'sports', color: '#e3202a', spawn: park(0, 8, 'e', 0.5), text: 'Steal the RED SPORTS CAR at the Marina.' },
      { type: 'goto', at: park(9, 9, 'w', 0.4), radius: 28, inVehicle: 'mission', timeLimit: 150, text: 'Get it to the crusher at Harlow Scrap before it gets reported!', failText: 'The car was reported. Too slow.' },
      { type: 'ambush', radius: 20, text: 'The Hollow Crows were waiting at the yard. Put them down!', spawns: [{ n: 4, gang: 'crows', weapon: ['pistol', 'pistol', 'uzi'] }],
        message: "That's MY car, you Cinelli rat! Boys, get him!", who: 'Big Dell' },
      { type: 'goto', at: park(9, 9, 'w', 0.4), radius: 6, inVehicle: 'mission', text: 'Drive it into the crusher.', onDone: 'crush', doneMessage: 'Crushed into a cube. Beautiful. Dell is going to cry into his hat.' },
    ],
    outro: "A cube! A little red cube! I'm keeping it on my desk. Here, buy yourself something that goes slower.",
  },
  {
    id: 'm3', order: 3, boss: 'cinelli', title: 'BAD DEBT', reward: 10000,
    intro: "A guy named Fisk owes me forty large and he's holed up at the Suds Laundromat on Baxter with his crew. Walk in there and settle the account. Neatly. I just had the carpet cleaned.",
    steps: [
      { type: 'goto', at: curb(2, 5, 'n', 0.5), radius: 22, text: 'Go to the Suds Laundromat on Baxter Street.' },
      { type: 'kill', text: "Settle the account. Fisk's boys first.", spawns: [
        { at: center(2, 5), n: 4, radius: 9, kind: 'gang', gang: 'debtors', weapon: ['pistol', 'pistol', 'uzi'] },
        { at: center(2, 5), n: 1, radius: 3, kind: 'gang', gang: 'debtors', miniBoss: true, name: 'Fisk', hp: 300, weapon: 'uzi', scale: 1.15, tint: '#9fd9a8',
          line: "Forty large? I spent it on a boat. A very small boat. BOYS! Get the nice man a receipt!" },
      ] },
      { type: 'destroy', vehicle: 'sedan', color: '#2e8b57', hp: 120, speed: 17, failText: 'Fisk Junior made it out of town. Forty large, gone.',
        route: [[2, 5], [3, 5], [3, 8], [8, 8], [8, 10]],
        gift: { vehicle: 'sports', at: park(2, 5, 'n', 0.55) },
        message: "You shot my DAD! Tell Marco the check is in the mail! IN THE MAIL!", who: 'Fisk Junior',
        text: "Fisk's son is running! Wreck his GREEN SEDAN before he leaves town. His boys' car is yours." },
    ],
    outro: "Fisk is a stain and the account is closed. You've got a way with people. Keep the phone close.",
  },
  {
    id: 'm11', order: 4, source: 'page', boss: 'cinelli', title: 'FOUR CASES', reward: 12000,
    page: "Pick up. It's Marco. It's urgent.",
    intro: "Four of my shopkeepers decided Thursday was optional. Their cases are waiting at the back doors, with muscle. Collect all four before the books close. Three minutes. Yes, I'm timing you.",
    steps: [
      { type: 'collect', sequential: true, timeLimit: 180, text: 'Collect the four cases before the books close.', failText: 'The books closed. Marco is displeased.',
        items: [curb(3, 3, 's', 0.5), curb(6, 3, 'n', 0.5), curb(6, 5, 's', 0.5),
          { ...curb(3, 5, 'e', 0.5), guards: { n: 1, gang: 'debtors', miniBoss: true, name: 'Sal Twice', hp: 280, weapon: 'shotgun', scale: 1.15, tint: '#e0b8a0',
            line: "They call me Sal Twice because I collect twice. Once from the shop. Once from YOU." } }],
        guards: { n: 2, gang: 'debtors', radius: 6, weapon: ['pistol', 'uzi'] },
        doneMessage: 'All four, and nobody counted short. I like you better already.' },
    ],
    outro: "Four cases, no shorts, and the only witnesses are in the hospital. That's what I call a good Thursday. Your cut.",
  },
  {
    id: 'm4', order: 5, boss: 'cinelli', title: 'HOT DELIVERY', reward: 12000,
    intro: "There's a white van on Kessler Avenue. It's full of something that goes bang. Drive it gently to the Hollow Crows' garage on Fenwick, light the fuse, and get clear. Gently, I said.",
    vehicleLost: 'The van went up early. So did the job.',
    steps: [
      { type: 'steal', vehicle: 'van', color: '#f4f4f4', spawn: park(7, 4, 'w', 0.5), text: "Pick up the WHITE VAN on Kessler Avenue. It's loaded." },
      { type: 'goto', at: park(8, 6, 'n', 0.5), radius: 7, inVehicle: 'mission', wanted: 2, timeLimit: 120, text: "The cops made the van! Deliver it to the Hollow Crows' garage. Do NOT crash it.",
        message: "Small detail I forgot to mention: a patrol car saw you load up. Don't stop for coffee.", failText: 'Too slow. The van was impounded.',
        doneMessage: 'Fuse is lit. Eight seconds. Run.' },
      { type: 'bombEscape', fuse: 8, text: 'GET OUT and get clear! The fuse is lit!' },
    ],
    outro: "Heh. Dell's garage is a parking lot now. Nice work. You're with the family.",
  },
  {
    id: 'm5', order: 6, boss: 'crows', title: 'PAYBACK', reward: 15000,
    intro: "Big Dell here! You torched my garage for Cinelli and now you're calling ME? Ha! Fine. Business is business. Marco's boys drink at the Golden Fig on Dock Street. Walk in and leave nobody standing. And when the cops show, and they always show, don't bring them home to me.",
    steps: [
      { type: 'goto', at: curb(4, 2, 's', 0.5), radius: 20, text: 'Get to the Golden Fig bar on Dock Street.' },
      { type: 'kill', text: "Wipe out Cinelli's crew. Leave nobody standing.", spawns: [
        { at: center(4, 2), n: 7, radius: 10, kind: 'gang', gang: 'cinelli', weapon: ['pistol', 'uzi', 'uzi', 'shotgun'] },
        { at: center(4, 2), n: 1, radius: 4, kind: 'gang', gang: 'cinelli', miniBoss: true, name: 'Knuckles', hp: 350, weapon: 'shotgun', scale: 1.2, tint: '#e8a0a0',
          line: "Knuckles don't need a gun, pal. But I brought one anyway. And a second opinion." },
      ] },
      { type: 'loseWanted', wanted: 3, text: 'Three heads on you! Lose them at Harlow Respray on Harlow Avenue.',
        message: 'Sirens! SIRENS! And somebody called Marco, kid, his cars are coming. Respray, go go go!', who: 'Big Dell',
        chasers: { n: 2, vehicle: 'sedan', gang: 'cinelli', after: 6 } },
    ],
    outro: "Ha! Marco's gonna choke on his linguine. We're square. For now.",
  },
  {
    id: 'm6', order: 7, boss: 'crows', title: 'TAIL LIGHTS', reward: 15000,
    intro: "A courier in a blue sports car just left Eastside with a case of my money. He's heading for the Harlow Bridge on the north side, and he's got friends. Ram him off the road before he gets there. Wreck the car, I don't care about the money. I care about the lesson.",
    steps: [
      { type: 'destroy', vehicle: 'sports', color: '#1f6fd0', hp: 150, speed: 17, failText: 'The courier made it to the bridge.',
        route: [[9, 2], [9, 0], [6, 0], [6, 3], [3, 3], [3, 0], [0, 0], [0, 2]],
        chasers: { n: 2, vehicle: 'sedan', gang: 'cinelli', after: 10 },
        message: "Two Cinelli sedans are riding his bumper, kid. They'll ram YOU before they let you touch him!", who: 'Big Dell',
        text: "Wreck the courier's BLUE SPORTS CAR before it reaches the Harlow Bridge." },
    ],
    outro: "That's what I call a lesson. The crews are talking about you now.",
  },
  {
    id: 'm12', order: 8, source: 'page', boss: 'crows', title: 'PINK SLIP', reward: 15000,
    page: "Kid! Pick up! It's Dell! It's urgent!",
    intro: "I bet the Cinelli kid's pink slip on a race I haven't won yet. His yellow Viper is parked off Kessler. Steal it and run the downtown loop through all six gates before the clock dies. The cops will love you. I'll love you more.",
    vehicleLost: 'You wrecked the Viper. Dell wanted to win it, not bury it.',
    steps: [
      { type: 'steal', vehicle: 'sports', color: '#f5d90a', spawn: park(7, 2, 's', 0.5), text: 'Steal the YELLOW VIPER GT parked off Kessler.' },
      { type: 'race', inVehicle: 'mission', wanted: 2, timeLimit: 80, text: 'Run the downtown loop, six gates, before the clock dies!',
        failText: 'The clock beat you. Dell lost the bet.', message: 'Gate one is the junction on your left. Cops are going to notice. Run it anyway!', who: 'Big Dell',
        checkpoints: [inter(6, 3), inter(3, 3), inter(3, 6), inter(5, 6), inter(5, 4), inter(7, 4)],
        doneMessage: 'Six gates! WE WIN! Park it somewhere and let the heat die!' },
    ],
    outro: "The slip is mine, the Viper is mine, and the Cinelli kid is crying in a taxi. You beautiful maniac.",
  },
  {
    id: 'm7', order: 9, boss: 'crows', title: 'CLEAN SLATE', reward: 10000,
    intro: "There's a grey sedan on the corner of Fenwick and 6th. Cops made it an hour ago and they're watching. Take it, lose the heat at Harlow Respray, then bring it back clean to my lockup on Fenwick. Not a scratch.",
    vehicleLost: 'The sedan is scrap. Dell wanted it clean, not crushed.',
    steps: [
      { type: 'steal', vehicle: 'sedan', color: '#8d9299', spawn: park(7, 6, 's', 0.5), text: 'Take the GREY SEDAN on the corner.' },
      { type: 'loseWanted', wanted: 3, inVehicle: 'mission', text: "You're hot. Lose the heat at Harlow Respray on Harlow Avenue.", message: 'Cops made you. Get to the respray and lose them!' },
      { type: 'goto', at: park(8, 3, 'e', 0.5), radius: 7, inVehicle: 'mission', text: 'Bring the clean sedan to the lockup on Fenwick.' },
    ],
    outro: "Clean as a whistle. You're a professional. Sister Mal's been asking about you, by the way. Be nice. She bites.",
  },
  {
    id: 'm8', order: 10, boss: 'mal', title: 'THE WITNESS', reward: 20000,
    intro: "Child, you've been busy. The police are moving a witness from the Harlow precinct to the courthouse in a black limousine, with an escort. If he testifies, half this city sleeps in a cell. See that he does not arrive.",
    steps: [
      { type: 'destroy', vehicle: 'limo', hp: 180, speed: 10, escorts: 2, wanted: 2, failText: 'The convoy reached the courthouse.',
        route: [[8, 8], [8, 6], [6, 6], [6, 7], [4, 7], [4, 6], [3, 6], [3, 7]],
        text: 'Destroy the BLACK LIMO before it reaches the courthouse.',
        doneMessage: "Oh, child. The limousine was empty. Forgive me, I should have prayed harder. The witness is in the police van, taking the long way round." },
      { type: 'destroy', vehicle: 'van', color: '#33415c', hp: 150, speed: 11, escorts: 2, wanted: 3, failText: 'The witness reached the courthouse after all.',
        route: [[7, 8], [7, 9], [2, 9], [2, 8], [4, 8], [4, 7]],
        text: 'The real witness is in the POLICE VAN. Wreck it before it reaches the courthouse!' },
    ],
    outro: 'The Lord works in mysterious ways. Today He worked through you. Bless you, child.',
  },
  {
    id: 'm13', order: 11, boss: 'mal', title: 'COLLECTION PLATE', reward: 22000,
    intro: "The congregation has been generous. Eleven thousand in small bills, in a truck, driven by a man who faints at the sight of blood. Marco's wolves have smelled it. See the truck to the Harbour Mission, child. Walk beside it, drive beside it, but do not let it fall.",
    steps: [
      { type: 'goto', at: park(1, 3, 'w', 0.5), radius: 12, text: 'Meet the donations truck outside the Chapel of Mercy.' },
      { type: 'escort', vehicle: 'van', color: '#f4f4f4', hp: 280, speed: 11, route: [[1, 3], [1, 5], [4, 5], [4, 8], [2, 8]],
        text: 'Escort the donations truck to the Harbour Mission. Keep the wolves off it!', failText: 'The donations truck was wrecked.',
        message: "Stay close to the truck, child. The driver is already praying.", who: 'Sister Mal',
        waves: [
          { after: 10, n: 2, vehicle: 'sedan', gang: 'cinelli', message: 'Wolves on the left, child. Two of them.' },
          { after: 32, n: 2, vehicle: ['sedan', 'compact'], gang: 'cinelli', message: 'More wolves! They are not subtle, are they?' },
          { after: 54, n: 3, vehicle: 'sedan', gang: 'cinelli', message: "Marco sent everyone. That's a compliment, child. Hold on." },
        ] },
      { type: 'ambush', radius: 22, text: 'The Deacon sold the Mission to Marco. Put him down!', spawns: [
        { n: 2, gang: 'cinelli', weapon: ['pistol', 'uzi'] },
        { n: 1, gang: 'cinelli', miniBoss: true, name: 'The Deacon', hp: 400, weapon: 'shotgun', scale: 1.2, tint: '#a58ad0',
          line: "Let us pray. Not for you, my son. You are well past praying for." },
      ], message: "Oh, child. The Deacon. He took Marco's envelope and left the plate empty. Forgive him quickly, and then forgive him again.", who: 'Sister Mal' },
    ],
    outro: "Eleven thousand, delivered, and three of Marco's wolves will not be needing supper. Bless you.",
  },
  {
    id: 'm9', order: 12, boss: 'mal', title: 'BANK JOB', reward: 30000,
    intro: "My congregation needs a new roof. The First Harlow Bank has a vault full of roof. Pick up my crew at the Chapel of Mercy, drive them to the bank, and keep the police busy while they work. Then bring everyone home.",
    steps: [
      { type: 'goto', at: park(1, 3, 'e', 0.5), radius: 8, inVehicle: 'any', text: 'Get a car and pick up the crew at the Chapel of Mercy.', doneMessage: "We're in. Drive, and don't talk.", doneWho: 'Crew' },
      { type: 'goto', at: park(5, 4, 's', 0.5), radius: 8, inVehicle: 'mission', text: 'Drive the crew to First Harlow Bank.', doneMessage: 'Sixty seconds. Keep the cops off us!', doneWho: 'Crew' },
      { type: 'defend', duration: 60, at: center(5, 4, 0, 14), radius: 40, wanted: 3, text: 'Hold the bank while the crew cracks the vault. Stay near the bank!',
        waves: [
          { after: 12, n: 3, gang: 'cinelli', weapon: 'pistol', message: "Cinelli's men! Somebody told Marco about the vault!", who: 'Crew' },
          { after: 30, n: 4, gang: 'cinelli', weapon: 'uzi', message: 'Second wave coming from the street. Thirty seconds!', who: 'Crew' },
          { after: 46, n: 3, gang: 'cinelli', weapon: 'shotgun' },
        ] },
      { type: 'goto', at: park(1, 2, 'w', 0.5), radius: 8, inVehicle: 'any', wanted: 4, text: 'Four heads! Get the crew and the cash to the safehouse on Vale Street.', message: 'Vault is open! Grab a car and get us out of here, the whole city heard that!', who: 'Crew' },
    ],
    outro: 'A new roof, and a new organ. You are a blessing. One more thing, child, and then you rest.',
  },
  {
    id: 'm14', order: 13, source: 'page', boss: 'mal', title: 'BURN NOTICE', reward: 25000,
    page: 'Child. Pick up. The Lord has shown me a fire.',
    intro: "Marco keeps his three best trucks at Harlow Scrap, loaded with everything he is. The Lord made fire for a reason. There's a flamethrower coming your way. Burn all three before the night shift arrives.",
    steps: [
      { type: 'goto', at: curb(9, 9, 'w', 0.5), radius: 26, text: 'Go to Harlow Scrap in the south-east corner.' },
      { type: 'destroyAll', timeLimit: 60, give: { flame: 250 }, select: 'flame', text: "Burn all three of Marco's trucks. Hold FIRE close to them!", failText: 'The night shift arrived. The trucks survived.',
        message: 'Take the flamethrower, child. Pray, then burn.', who: 'Sister Mal',
        vehicles: [
          { type: 'van', at: park(9, 9, 'n', 0.3), color: '#d9b24c', hp: 130 },
          { type: 'pickup', at: park(9, 9, 'n', 0.75), color: '#d9b24c', hp: 130 },
          { type: 'van', at: park(9, 9, 'e', 0.5), color: '#d9b24c', hp: 130 },
        ] },
      { type: 'ambush', radius: 20, text: 'The night shift came early. Put them down!', spawns: [
        { n: 4, gang: 'cinelli', weapon: ['pistol', 'uzi'] },
        { n: 1, gang: 'cinelli', miniBoss: true, name: 'Foreman Brick', hp: 320, weapon: 'uzi', scale: 1.25, tint: '#d9b24c',
          line: "Nobody burns my trucks and walks home. Well. You'll be crawling." },
      ],
        message: "My trucks! MY TRUCKS! Boys, put him in the fire!", who: 'Marco Cinelli' },
    ],
    outro: "Three trucks of ash and four men with something to think about. I'll keep a candle lit for you.",
  },
  {
    id: 'm10', order: 14, boss: 'mal', title: 'LAST RITES', reward: 75000,
    intro: "Child. I have been counting the collection plate and the numbers have a landlord. Marco, Dell and I all send our envelopes to one address: Julpie's House, in the north-east corner. Somebody named Julpie has owned all three of us since the beginning. Marco is holed up at the Blackwater warehouse and he knows the way. Start there. Then pay Julpie a visit.",
    bossLines: [
      { id: 'm10.boss1', who: 'Julpie', text: JULPIE_P1 },
      { id: 'm10.boss2', who: 'Julpie', text: JULPIE_P2 },
    ],
    steps: [
      { type: 'goto', at: curb(8, 9, 'n', 0.5), radius: 34, text: 'Get to the Blackwater warehouse on the docks.' },
      { type: 'destroy', vehicle: 'armoured', fallback: 'limo', hp: 700, speed: 14, failText: 'Marco got away in the armoured car.',
        route: [[8, 9], [8, 7], [5, 7], [5, 9], [8, 9], [8, 7], [5, 7], [5, 10], [9, 10]],
        give: { rocket: 8 }, select: 'rocket',
        chasers: { n: 2, vehicle: 'sedan', gang: 'cinelli', after: 12 },
        message: "He's running in the armoured car! Bullets bounce off it. Ram him or take the launcher, eight rockets. Aim low!", who: 'Crew',
        text: "Marco is fleeing in an ARMOURED SUV! Rockets and rams only: bullets bounce.",
        doneMessage: 'You... you have no idea what you have done! Boys, KILL him!', doneWho: 'Marco Cinelli' },
      { type: 'kill', text: 'Marco is on foot. Kill Marco Cinelli and his crew.', spawns: [
        { at: 'prev', n: 6, radius: 9, kind: 'gang', gang: 'cinelli', alerted: true, weapon: ['uzi', 'pistol', 'shotgun', 'uzi'] },
        { at: 'prev', n: 1, radius: 3, kind: 'gang', gang: 'cinelli', alerted: true, miniBoss: true, name: 'Marco Cinelli', hp: 420, weapon: 'shotgun', scale: 1.2, tint: '#d9b24c' },
      ], doneMessage: "Julpie... it was always Julpie. The house. North-east corner. Pink gate. Tell them... I wanted the pool...", doneWho: 'Marco Cinelli' },
      { type: 'goto', at: MANSION.gate, radius: 14, text: "Get to Julpie's House in the north-east corner.",
        message: "That's it. Pink gate, pink guards, pink everything. Whoever Julpie is, they really like pink. Watch the gate!", who: 'Crew' },
      { type: 'ambush', text: "Assault the gate! Julpie's guards are in pink.", spawns: [
        { at: { x: MANSION.cx, z: MANSION.iz1 + 3 }, n: 5, radius: 6, gang: 'julpie', weapon: ['pistol', 'uzi', 'shotgun', 'uzi'] },
      ], doneMessage: "Gate's down. Courtyard next. There's a butler. Do not let him near the fountain.", doneWho: 'Crew' },
      { type: 'kill', text: "Fight through the courtyard. The butler is armed.", spawns: [
        { at: MANSION.courtyard, n: 4, radius: 5, kind: 'gang', gang: 'julpie', alerted: true, weapon: ['uzi', 'pistol', 'shotgun', 'uzi'] },
        { at: MANSION.courtyard, n: 1, radius: 3, kind: 'gang', gang: 'julpie', alerted: true, miniBoss: true, name: 'Jeeves the Butler', hp: 380, weapon: 'shotgun', scale: 1.2, tint: '#c8c8ff',
          line: "Julpie does not receive armed guests. I shall have to ask you to leave. Through the fountain." },
      ], doneMessage: "Butler down, hedges ruined. Julpie is out the back, on the terrace garden. Go round the side of the house!", doneWho: 'Crew' },
      { type: 'goto', at: MANSION.side, radius: 4.5, text: 'Slip round the east side of the house to the back garden.' },
      { type: 'kill', bounds: 'mansion', text: 'Finish JULPIE in the terrace garden behind the house!', spawns: [
        { at: { x: MANSION.garden.x, z: MANSION.garden.z + 1.5 }, n: 1, radius: 2, kind: 'gang', gang: 'julpie', boss: true, name: 'Julpie', hp: 900, weapon: 'dual', scale: 1.25, tint: '#ff9ad0', alertRange: 40,
          line: JULPIE_HELLO },
      ],
        grenades: { first: 7, every: 9, dmg: 55, radius: 5, fuse: 1.7 },
        bossScript: [
          { at: 0.6, say: JULPIE_P1, toast: 'JULPIE CALLS FOR BACKUP!', guards: { n: 4, gang: 'julpie', weapon: ['uzi', 'shotgun', 'pistol', 'uzi'] } },
          { at: 0.3, say: JULPIE_P2, toast: 'JULPIE CHARGES!', weapon: ['sword', 'shotgun'], charge: true },
        ],
        doneMessage: JULPIE_DEAD, doneWho: 'Julpie' },
    ],
    outro: "Julpie's House is a crime scene and the pool is not blue any more. Every crown in Port Harlow is on your head now, sinner. Go with God. And mind the piranhas.",
  },
];
