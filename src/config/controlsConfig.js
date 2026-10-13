// Semantic actions and their default bindings. Game code only ever sees action names.

export const ACTION_LIST = [
  { id: 'lightAttack', label: 'Light punch', hint: 'Punch' },
  { id: 'heavyAttack', label: 'Heavy smash', hint: 'Smash' },
  { id: 'dodge', label: 'Dodge', hint: 'Dodge' },
  { id: 'block', label: 'Block', hint: 'Block' },
  { id: 'pause', label: 'Pause', hint: 'Pause' },
  { id: 'confirm', label: 'Confirm', hint: 'Select' },
  { id: 'cancel', label: 'Cancel / Back', hint: 'Back' },
  { id: 'navUp', label: 'Menu up', hint: 'Up' },
  { id: 'navDown', label: 'Menu down', hint: 'Down' },
  { id: 'navLeft', label: 'Menu left', hint: 'Left' },
  { id: 'navRight', label: 'Menu right', hint: 'Right' },
];

export const BUTTON_ACTIONS = ACTION_LIST.map((a) => a.id);

// Order used by the guided setup wizard (menu navigation comes last because the
// D-pad is often the hardest thing to discover on odd controllers).
export const WIZARD_ORDER = ['lightAttack', 'heavyAttack', 'dodge', 'block', 'pause', 'confirm', 'cancel', 'navUp', 'navDown', 'navLeft', 'navRight'];

/** Defaults that are only applied when the browser reports mapping === "standard". */
export const STANDARD_DEFAULTS = {
  move: { type: 'stick', xAxis: 0, yAxis: 1, invertX: false, invertY: false },
  lightAttack: [{ type: 'button', index: 2 }], // west
  heavyAttack: [{ type: 'button', index: 3 }], // north
  dodge: [{ type: 'button', index: 0 }], // south
  block: [
    { type: 'button', index: 6 }, // left trigger
    { type: 'button', index: 4 }, // left bumper
  ],
  pause: [{ type: 'button', index: 9 }], // start / menu
  confirm: [{ type: 'button', index: 0 }],
  cancel: [{ type: 'button', index: 1 }], // east
  navUp: [{ type: 'button', index: 12 }],
  navDown: [{ type: 'button', index: 13 }],
  navLeft: [{ type: 'button', index: 14 }],
  navRight: [{ type: 'button', index: 15 }],
};

/** Labels for the "standard" layout (Xbox-style letters; positions are what matters). */
export const STANDARD_BUTTON_NAMES = [
  'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home',
];

export const KEY_BINDINGS = {
  moveUp: ['KeyW', 'ArrowUp'],
  moveDown: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  lightAttack: ['KeyJ', 'KeyZ'],
  heavyAttack: ['KeyK', 'KeyX'],
  dodge: ['Space', 'KeyL'],
  block: ['ShiftLeft', 'ShiftRight', 'KeyI', 'KeyC'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'Space', 'NumpadEnter'],
  cancel: ['Escape', 'Backspace'],
  navUp: ['ArrowUp', 'KeyW'],
  navDown: ['ArrowDown', 'KeyS'],
  navLeft: ['ArrowLeft', 'KeyA'],
  navRight: ['ArrowRight', 'KeyD'],
};

export const KEY_LABELS = {
  lightAttack: 'J',
  heavyAttack: 'K',
  dodge: 'Space',
  block: 'Shift',
  pause: 'Esc',
  confirm: 'Enter',
  cancel: 'Esc',
  navUp: '↑',
  navDown: '↓',
  navLeft: '←',
  navRight: '→',
  move: 'WASD',
};

export const INPUT_DEFAULTS = {
  deadZone: 0.16,
  deadZoneMin: 0.05,
  deadZoneMax: 0.5,
  pressThreshold: 0.55,
  releaseThreshold: 0.35,
  navThreshold: 0.6,
  navRepeatDelay: 0.38,
  navRepeatRate: 0.115,
};
