/**
 * Who speaks in the game and what they should sound like. Used by `npm run voice-lines` to build
 * the TTS script (see VOICES.md). The `voice` text is a description for whoever records or prompts
 * the TTS model; `ref` is the suggested reference-clip file name for voice-cloning models.
 */
export const VOICES = {
  'Marco Cinelli': { ref: 'cinelli.wav', voice: 'Gravelly old-school mob boss, slow and amused, chews every vowel, faint wheeze.' },
  'Big Dell': { ref: 'dell.wav', voice: 'Huge booming laugh, fast talker, always slightly shouting like he is in a loud garage.' },
  'Sister Mal': { ref: 'mal.wav', voice: 'Soft sing-song church lady who never raises her voice even when ordering a hit. Slightly too sweet.' },
  'Tony': { ref: 'tony.wav', voice: 'Nasal, whiny, car-sick cousin. Talks with his mouth full.' },
  'Julpie': { ref: 'julpie.wav', voice: 'Over-the-top mansion kingpin: gleeful, theatrical, switches from purring to screaming mid-sentence, laughs at their own jokes, sounds like they are always holding a cocktail and a grenade.' },
  'Knuckles': { ref: 'knuckles.wav', voice: 'Dim, enormous enforcer with a slow low rumble, cracks his knuckles between sentences, politely threatening.' },
  'Sal Twice': { ref: 'saltwice.wav', voice: 'Fast, smug collector who says everything twice. Twice. Gum-chewing smirk.' },
  'The Deacon': { ref: 'deacon.wav', voice: 'Hushed, sorrowful pulpit baritone, almost sung, turns to a snarl on the last word.' },
  'Foreman Brick': { ref: 'brick.wav', voice: 'Hoarse warehouse foreman shouting over machinery, sounds like gravel in a bucket.' },
  'Jeeves the Butler': { ref: 'jeeves.wav', voice: 'Impeccably polite English butler, perfectly calm, every sentence an insult wrapped in good manners.' },
  'Fisk Junior': { ref: 'fiskjr.wav', voice: 'Furious teenage driver crying and shouting out of a car window, voice cracking.' },
  'Fisk': { ref: 'fisk.wav', voice: 'Panicky debtor, squeaky and breathless, shouting out of a car window while the engine whines.' },
  'Crew': { ref: 'crew.wav', voice: 'Tense, clipped, out of breath. Three people talking over each other is fine.' },
  'Sal Bruno': { ref: 'sal.wav', voice: 'Indignant New York cabbie, leaning on an imaginary horn, talks with his hands.' },
  'Cab Thief': { ref: 'cabthief.wav', voice: 'Panting teenage joyrider, cracking voice, nervous laugh.' },
  'Pete Okafor': { ref: 'pete.wav', voice: 'Warm, tired dockworker with a deep voice who keeps looking over his shoulder.' },
  'Lenny Vasco': { ref: 'lenny.wav', voice: 'Whispering, sweaty, terrified witness who talks too fast and swallows words.' },
  'Dani Reyes': { ref: 'dani.wav', voice: 'Cocky street racer, grinning, confident and a little too loud.' },
  'Greta Holm': { ref: 'greta.wav', voice: 'Crisp, no-nonsense shopkeeper who has seen it all and is not impressed.' },
  'Dispatch': { ref: 'dispatch.wav', voice: 'Bored radio dispatcher, crackly, flat, one cough away from retiring.' },
  'Fare': { ref: 'fare.wav', voice: 'Rushed passenger in the back seat, impatient, a little rude.' },
  'Stranger': { ref: 'stranger.wav', voice: 'Out-of-breath bystander shouting for help, panicked, running while talking.' },
  'Pager': { ref: 'pager.wav', voice: 'Deadpan robotic answering-machine voice with a tiny bit of static. Can be a vocoder.' },
};
