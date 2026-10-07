import { useContext } from 'react';
import { RentalRangeContext } from './rentalRangeState';

// The rental dates picked in the navbar: `const { range, setRange } = useRentalRange();`
// `range` is `{ start, end }` as 'YYYY-MM-DD' strings.
export function useRentalRange() {
  return useContext(RentalRangeContext);
}
