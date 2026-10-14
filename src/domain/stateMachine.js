const { InvalidTransitionError } = require('../errors');

/**
 * Generic finite-state machine. Each MedLab entity (order, specimen, order item)
 * gets its own instance with an explicit transition table, so an invalid move
 * (e.g. result before collection, release before review) is rejected by the
 * system, not by convention (R-07, R-14).
 */
class StateMachine {
  constructor(entity, transitions) {
    this.entity = entity;
    this.transitions = transitions; // { FROM: [TO, ...] }
    this.states = new Set([
      ...Object.keys(transitions),
      ...Object.values(transitions).flat(),
    ]);
  }

  canTransition(from, to) {
    return (this.transitions[from] || []).includes(to);
  }

  assertTransition(from, to, reason) {
    if (!this.canTransition(from, to)) {
      throw new InvalidTransitionError(this.entity, from, to, reason);
    }
  }

  nextStates(from) {
    return [...(this.transitions[from] || [])];
  }
}

// Order item = one component test. This is the main lab workflow:
// Collection -> In Processing -> Result Available -> Review -> Released.
const ITEM = Object.freeze({
  COLLECTION_REQUIRED: 'COLLECTION_REQUIRED',
  COLLECTED: 'COLLECTED',
  IN_PROCESSING: 'IN_PROCESSING',
  RESULT_AVAILABLE: 'RESULT_AVAILABLE',
  UNDER_REVIEW: 'UNDER_REVIEW',
  RELEASED: 'RELEASED',
  CANCELLED: 'CANCELLED',
});

const orderItemMachine = new StateMachine('order item', {
  COLLECTION_REQUIRED: ['COLLECTED', 'CANCELLED'],
  COLLECTED: ['IN_PROCESSING', 'COLLECTION_REQUIRED', 'CANCELLED'], // -> COLLECTION_REQUIRED on rejection
  IN_PROCESSING: ['RESULT_AVAILABLE', 'COLLECTION_REQUIRED'],        // -> COLLECTION_REQUIRED on rejection
  RESULT_AVAILABLE: ['UNDER_REVIEW', 'RESULT_AVAILABLE'],            // re-entry before submit = new version
  UNDER_REVIEW: ['RELEASED', 'IN_PROCESSING'],                       // approve, or return for retest
  RELEASED: [],                                                      // terminal; amendments add versions
  CANCELLED: [],
});

const specimenMachine = new StateMachine('specimen', {
  COLLECTED: ['IN_PROCESSING', 'REJECTED'],
  IN_PROCESSING: ['REJECTED'],
  REJECTED: [],
});

const orderMachine = new StateMachine('order', {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'], // ASSIGNED->ASSIGNED = reassignment
  IN_PROGRESS: ['IN_PROGRESS', 'CLOSED'],             // reassignment allowed mid-progress
  CLOSED: [],
  CANCELLED: [],
});

// Ordinal used to compute "least-complete component" for panels (R-03).
const ITEM_PROGRESS = {
  COLLECTION_REQUIRED: 0,
  COLLECTED: 1,
  IN_PROCESSING: 2,
  RESULT_AVAILABLE: 3,
  UNDER_REVIEW: 4,
  RELEASED: 5,
};

/** Panel status = least-complete non-cancelled component (R-03). */
function panelStatus(itemStatuses) {
  const live = itemStatuses.filter((s) => s !== ITEM.CANCELLED);
  if (live.length === 0) return ITEM.CANCELLED;
  return live.reduce((min, s) => (ITEM_PROGRESS[s] < ITEM_PROGRESS[min] ? s : min));
}

/** An order may close only when every test is released or cancelled (R-14). */
function canCloseOrder(itemStatuses) {
  return itemStatuses.length > 0 && itemStatuses.every((s) => s === ITEM.RELEASED || s === ITEM.CANCELLED);
}

module.exports = {
  StateMachine,
  ITEM,
  orderItemMachine,
  specimenMachine,
  orderMachine,
  panelStatus,
  canCloseOrder,
};
