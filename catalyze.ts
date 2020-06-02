import { Molecule, reaction, MoleculeProps } from "./molecule";

/**
 * global state of the entire chain reaction
 */
export type ChainReactionState =
  | "executing"
  | "invalidating"
  | "error"
  | "finished";

/**
 * Execute a chain reaction: a directed graph of server fetches
 *
 * The graph is represented as an array of atom groups, where each
 * atom is an async function that responds to dependencies by initiating
 * fetches from the server. Each atom group is a keyed map by dependency name.
 *
 * The generator runs infinitely, and yields at the beginning and end of
 * each atom group, to allow responding to pending state and resolved state
 * for each individual atom.
 *
 * When dependencies change at any point, it will invalidate the executing chain
 * and start over.
 */
export async function* catalyze<Atoms extends Molecule>(
  chemicals: Atoms
): AsyncGenerator<[ChainReactionState, MoleculeProps], void, MoleculeProps> {
  let generator = startReaction(chemicals);
  let props: MoleculeProps = {};
  let state: ChainReactionState = "executing";
  let externalProps: MoleculeProps = {};
  while (true) {
    // iterate over the chemical groups one by one
    externalProps = yield [state, props];
    for (
      let atomGroupNumber = 0;
      atomGroupNumber < chemicals.length;
      atomGroupNumber++
    ) {
      // get the atomic reaction promises of this group
      const promiseReaction: MoleculeProps = await generator.next({
        ...props,
        ...externalProps,
      });
      props = promiseReaction.value;
      if (shouldAbort(externalProps, yield [state, props])) {
        state = "invalidating";
        break;
      }
      // get the resolved atomic reactions of this group
      const resolvedReaction: MoleculeProps = await generator.next(props);
      props = resolvedReaction.value;
      if (hasErrors(props)) {
        state = "error";
        yield [state, props];
        // abort but don't restart the generator
        break;
      }
      if (atomGroupNumber === chemicals.length - 1) {
        state = "finished";
      }
      if (shouldAbort(externalProps, yield [state, props])) {
        props = {};
        state = "invalidating";
        break;
      }
    }
    if (state === "finished") {
      // start again
      state = "executing";
    }
    if (state === "invalidating") {
      // the dependencies have changed, invalidate the local chain reaction cache
      generator = startReaction(chemicals, generator);
      state = "executing";
    }
  }
}

/**
 * checks each atom, and if any have failed, returns truthy
 */
function hasErrors(group: MoleculeProps) {
  return Object.values(group).filter((prop) => prop instanceof Error).length;
}

/**
 * Helper function to start a new chain reaction
 *
 * Solely to DRY up `reaction()`
 */
function startReaction(
  chemicals: Molecule,
  lastGenerator?: AsyncGenerator<MoleculeProps, void, MoleculeProps>
) {
  const generator = reaction(chemicals);
  // start the reaction
  generator.next();
  if (lastGenerator) {
    // dispose the last generator
    lastGenerator.return();
  }
  return generator;
}

/**
 * Helper function, used to detect when dependencies change
 *
 * This is used to short-circuit the chain reaction and start a new one
 */
function shouldAbort(prev: MoleculeProps, next: MoleculeProps) {
  return prev !== next;
}
