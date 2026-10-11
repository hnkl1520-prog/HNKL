// Authored flat artwork. Origins are the head centre, ankle and wrist;
// closed cuffs overlap the limb underneath instead of meeting it edge to edge.
const ink = '#26333B';
const blue = '#3F64AD';
const skin = '#F0B998';
const yellow = '#F3C64F';
const hair = '#805135';

export const HEAD_PATHS = [
  // Hair sits behind the ear and neck, with a simple rounded back silhouette.
  { d: 'M-17-19Q-23-12-19-5Q-23 0-20 5Q-23 10-18 13Q-18 18-12 18Q-6 17-5 10L-3-13Z', fill: hair },
  // Eye-free profile: brow, a small nose, cheek and chin are one outline.
  { d: 'M-13-20Q-1-25 12-18Q17-14 16-8L21-2Q23 1 18 3L16 4V11Q16 20 8 21H3L2 24L-11 20L-9 9Q-16 4-15-3Z', fill: skin },
  // The ear is integrated into the face, rather than outlined as a separate disk.
  { d: 'M-7-3Q-9-9-13-8Q-19-8-16-1Q-14 3-10 3', fill: skin, strokeWidth: 1.15 },
  // Dome and slightly rising brim retain the construction-helmet silhouette.
  { d: 'M-22-17Q-22-35-5-37Q15-38 20-19L20-17Z', fill: yellow },
  { d: 'M-5-36Q7-34 11-21M0-36Q12-31 15-21', fill: 'none', strokeWidth: 1.05 },
  { d: 'M-23-18Q-6-22 21-20L25-20Q27-20 26-17L-23-13Q-26-13-25-16Z', fill: yellow },
];

export const BOOT_PATHS = [
  // Trouser hems cover the top of this dark work-boot collar.
  { d: 'M-11-13H9L10-2H-12Z', fill: ink },
  { d: 'M-12-6L3-5Q8-9 11-5L13 2Q18 7 25 7Q35 7 36 13V16Q35 17 32 17H17L14 15H8L6 17H-13Z', fill: yellow },
  { d: 'M-12 12Q0 12 10 13H35', fill: 'none', strokeWidth: 1.1 },
  { d: 'M7-3L16 7M4-1L11-3M7 2L14 0M10 5L17 3', fill: 'none', strokeWidth: 1.05 },
];

export const HAND_PATHS = {
  // Forearm enters from above. Staggered fingertips and a separate thumb
  // silhouette make a relaxed glove readable even at its small display size.
  rest: [
    { d: 'M-9-6H9L8 4Q11 7 13 13Q14 17 11 18Q9 18 8 13L8 21Q8 24 5 24Q3 24 3 22V24Q2 26-1 24L-2 23Q-3 25-6 23L-7 21Q-10 22-11 18L-12 10Q-12 5-8 3Z', fill: blue },
    { d: 'M-8 3H7M-6 15L-5 21M-1 15V22M4 14V21', fill: 'none', strokeWidth: 1.05 },
  ],
  // Forearm enters from below; the flat top of the palm touches y = -15.
  // The asymmetry distinguishes the thumb/heel of the hand from the fingers.
  ceiling: [
    { d: 'M-8 8L-7-2Q-13-3-17-7Q-20-10-18-13Q-17-15-13-15H17Q20-15 20-12Q20-10 16-9L10-8Q7-6 8-2L9 8Z', fill: blue },
    { d: 'M-7 1L8 2M-7-3Q-3-2 0-4M11-12H18M10-9H15', fill: 'none', strokeWidth: 1.05 },
  ],
  // Forearm enters from the left. Fingertips point up and the palm presses
  // the wall at x = 15; wrist and palm remain a single closed shape.
  wall: [
    { d: 'M-8-9L1-9L2-19Q2-23 5-23Q7-23 7-19V-20Q7-25 10-25Q12-25 12-20Q14-22 15-18V1Q15 7 8 9L-8 10Z', fill: blue },
    { d: 'M-1-8V8M7-18V-9M11-17V-8M2-4Q6-6 8-2Q8 1 5 3', fill: 'none', strokeWidth: 1.05 },
  ],
  // Seated support palm; the fingers and heel of the hand meet y = 15.
  floor: [
    { d: 'M-8-8L-7 2Q-13 3-17 7Q-20 10-18 13Q-17 15-13 15H17Q20 15 20 12Q20 10 16 9L10 8Q7 6 8 2L9-8Z', fill: blue },
    { d: 'M-7-1L8-2M-7 3Q-3 2 0 4M11 12H18M10 9H15', fill: 'none', strokeWidth: 1.05 },
  ],
};
