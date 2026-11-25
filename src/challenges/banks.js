export const BANK_VERSION = 'messages-v1';
const easy = [
  'Every letter has a place.', 'Small steps lead to discovery.', 'Find the hidden message.', 'Learning opens new doors.',
  'Share your ideas with friends.', 'Keep trying a different shift.', 'The blue sky looks bright.', 'Bring a pencil and paper.',
  'We learn by asking questions.', 'A good puzzle takes patience.', 'Look closely at each letter.', 'The secret is in plain sight.',
  'Turn the key and explore.', 'Your next clue is here.', 'Practice makes new skills grow.', 'Read the words out loud.',
  'Take a break and think.', 'Great ideas start with curiosity.', 'Meet us by the library.', 'A little teamwork can help.',
  'Try something new this morning.', 'The race begins with you.', 'Follow the letters around again.', 'Our workshop welcomes every learner.'
];
const hard = [
  'Every great discovery begins with a simple question.', 'When one idea fails, try looking from another angle.',
  'A secret message can hide inside an ordinary sentence.', 'Share what you learn, and help someone else discover it.',
  'The best way to understand a puzzle is to experiment.', 'Letters move around the alphabet, but spaces stay still.',
  'Bring your curiosity to the workshop and explore together.', 'A small change in perspective can reveal the whole message.',
  'Keep the punctuation in place while you move each letter.', 'You can solve this message with patience and a pencil.',
  'Good questions are often more useful than quick guesses.', 'Follow each clue carefully; the answer is within reach.',
  'The library opens early, so we can meet before lunch.', 'New skills grow stronger when you practice them with friends.',
  'Watch the letters wrap around when they reach the end.', 'Try every possible shift, then read the results out loud.',
  'A large collection of keys does not always mean security.', 'Learning together makes even a difficult challenge feel possible.',
  'Take your time, check each word, and trust your reasoning.', 'Our next adventure starts with a message from a friend.',
  'Patterns in ordinary language can help us uncover a secret.', 'After the last letter comes the first one once again.',
  'You do not need to write code to explore cryptography.', 'Ask a new question whenever an answer surprises you.'
];
export const banks = Object.freeze(Object.fromEntries(Object.entries({ easy, hard }).map(([difficulty, texts]) => [difficulty, Object.freeze(texts.map((plaintext, i) => Object.freeze({ id: `${difficulty}-${i + 1}`, plaintext, difficulty })))])));
