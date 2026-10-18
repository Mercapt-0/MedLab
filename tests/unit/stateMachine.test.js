const { orderItemMachine, specimenMachine, orderMachine, panelStatus, canCloseOrder, ITEM } = require('../../backend/src/domain/stateMachine');
const { InvalidTransitionError } = require('../../backend/src/errors');

describe('Order item state machine (R-07, R-14)', () => {
  test('happy path Collection -> In Processing -> Result Available -> Review -> Released', () => {
    const path = ['COLLECTION_REQUIRED', 'COLLECTED', 'IN_PROCESSING', 'RESULT_AVAILABLE', 'UNDER_REVIEW', 'RELEASED'];
    for (let i = 0; i < path.length - 1; i++) {
      expect(orderItemMachine.canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  test.each([
    ['COLLECTION_REQUIRED', 'RESULT_AVAILABLE', 'result before collection'],
    ['COLLECTION_REQUIRED', 'IN_PROCESSING', 'skip collection'],
    ['COLLECTED', 'RESULT_AVAILABLE', 'skip processing'],
    ['RESULT_AVAILABLE', 'RELEASED', 'release before review'],
    ['IN_PROCESSING', 'RELEASED', 'release from processing'],
    ['RELEASED', 'IN_PROCESSING', 'reopen a released result'],
    ['CANCELLED', 'COLLECTED', 'revive a cancelled test'],
  ])('rejects %s -> %s (%s)', (from, to) => {
    expect(orderItemMachine.canTransition(from, to)).toBe(false);
    expect(() => orderItemMachine.assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  test('retest returns UNDER_REVIEW -> IN_PROCESSING; rejection returns to COLLECTION_REQUIRED', () => {
    expect(orderItemMachine.canTransition('UNDER_REVIEW', 'IN_PROCESSING')).toBe(true);
    expect(orderItemMachine.canTransition('COLLECTED', 'COLLECTION_REQUIRED')).toBe(true);
    expect(orderItemMachine.canTransition('IN_PROCESSING', 'COLLECTION_REQUIRED')).toBe(true);
  });

  test('InvalidTransitionError carries HTTP 409 and details', () => {
    try {
      orderItemMachine.assertTransition('COLLECTION_REQUIRED', 'RELEASED');
    } catch (e) {
      expect(e.status).toBe(409);
      expect(e.code).toBe('INVALID_TRANSITION');
      expect(e.details).toEqual({ entity: 'order item', from: 'COLLECTION_REQUIRED', to: 'RELEASED' });
    }
  });
});

describe('Specimen and order machines', () => {
  test('specimen cannot leave REJECTED', () => {
    expect(specimenMachine.nextStates('REJECTED')).toEqual([]);
    expect(specimenMachine.canTransition('COLLECTED', 'REJECTED')).toBe(true);
  });
  test('order cannot close from PENDING or re-open after CLOSED', () => {
    expect(orderMachine.canTransition('PENDING', 'CLOSED')).toBe(false);
    expect(orderMachine.canTransition('CLOSED', 'IN_PROGRESS')).toBe(false);
  });
});

describe('Panel status = least-complete component (R-03)', () => {
  test('returns the least advanced live component', () => {
    expect(panelStatus(['RELEASED', 'IN_PROCESSING', 'UNDER_REVIEW'])).toBe('IN_PROCESSING');
    expect(panelStatus(['RELEASED', 'RELEASED'])).toBe('RELEASED');
  });
  test('ignores cancelled components', () => {
    expect(panelStatus(['RELEASED', 'CANCELLED'])).toBe('RELEASED');
    expect(panelStatus(['CANCELLED', 'CANCELLED'])).toBe(ITEM.CANCELLED);
  });
});

describe('Order closure rule (R-14)', () => {
  test('only when every item is released or cancelled', () => {
    expect(canCloseOrder(['RELEASED', 'CANCELLED'])).toBe(true);
    expect(canCloseOrder(['RELEASED', 'UNDER_REVIEW'])).toBe(false);
    expect(canCloseOrder([])).toBe(false);
  });
});
