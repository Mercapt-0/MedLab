/**
 * Injectable clock. Production uses real time; tests call setNow() to jump past
 * the panic acknowledgement window without real waiting (risk mitigation, Sec. 10).
 */
let override = null;

module.exports = {
  now: () => (override ? new Date(override) : new Date()),
  setNow: (date) => {
    override = date ? new Date(date) : null;
  },
  advance: (ms) => {
    override = new Date((override ? new Date(override) : new Date()).getTime() + ms);
  },
  reset: () => {
    override = null;
  },
};
