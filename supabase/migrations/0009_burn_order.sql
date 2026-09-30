-- $CIRCO — the last-ticket bonus follows the on-chain order of burns (slot), not the order the engine saw them.
alter table tickets add column burn_slot bigint;
