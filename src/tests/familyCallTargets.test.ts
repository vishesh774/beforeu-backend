import { describe, it, expect } from '@jest/globals';
import { getFamilyCallTargets } from '../services/sosCallService';

/**
 * This rule decides who gets phoned during an emergency, so it fails open by design: an account
 * that has never touched the emergency-contact flag must still reach the whole family.
 */
describe('getFamilyCallTargets', () => {
    const alice = { name: 'Alice', isEmergencyContact: true };
    const bob = { name: 'Bob', isEmergencyContact: false };
    const carol = { name: 'Carol' } as { name: string; isEmergencyContact?: boolean };

    it('calls only the nominated contacts when any are nominated', () => {
        expect(getFamilyCallTargets([alice, bob])).toEqual([alice]);
    });

    it('calls everyone when nobody is nominated', () => {
        expect(getFamilyCallTargets([bob, carol])).toEqual([bob, carol]);
    });

    it('treats a missing flag as not nominated rather than nominated', () => {
        // Carol has no flag at all; Alice is explicitly nominated, so only Alice is called.
        expect(getFamilyCallTargets([alice, carol])).toEqual([alice]);
    });

    it('returns an empty list for an empty family', () => {
        expect(getFamilyCallTargets([])).toEqual([]);
    });
});
