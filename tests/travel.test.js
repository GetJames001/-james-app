const test = require('node:test');
const assert = require('node:assert/strict');
const {tripDate, tripGroup, validTrip} = require('../travel');
const trip = {title:'Train trip', start:'2026-12-01', end:'2026-12-03', stops:['Station']};
test('groups trips by inclusive local calendar dates and handles an open end', () => {
  for (const [day, group] of [['2026-11-30','Upcoming trips'],['2026-12-01','Current trips'],
    ['2026-12-03','Current trips'],['2026-12-04','Past trips']]) assert.equal(tripGroup(trip,day),group);
  assert.equal(tripGroup({...trip,end:''},'2026-12-04'),'Started · end date open');
});
test('rejects invalid dates, reversed ranges and unrelated route links', () => {
  assert.equal(validTrip(trip),true);
  assert.equal(tripDate('2026-02-29'),false);
  assert.equal(validTrip({...trip,end:'2026-11-30'}),false);
  assert.equal(validTrip({...trip,route:'https://example.org/download?data=x'}),false);
});
