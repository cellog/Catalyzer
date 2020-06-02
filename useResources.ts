import { useState, useRef, useEffect } from "react";
import { Molecule, MoleculeProps, AtomState } from "./molecule";
import { catalyze, ChainReactionState } from "./catalyze";

/**
 * Declaratively fetch a directed graph of server resources, with full
 * support for dependencies and parallel fetching of non-dependent resources
 * @param chemical
 * @param deps
 */
export function useResources<
  ResourceShape extends MoleculeProps,
  Atoms extends Molecule = Molecule
>(
  chemical: Atoms,
  deps: MoleculeProps
): [ChainReactionState, AtomState<ResourceShape>] {
  const [props, setProps] = useState<[ChainReactionState, MoleculeProps]>([
    "executing",
    deps,
  ]);
  const generator = useRef<ReturnType<typeof catalyze>>(catalyze(chemical));
  const mounted = useRef(true);
  const useDeps = useRef(deps);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const abortWait = useRef<() => void>();
  const waitPromise = useRef<Promise<any>>();
  const invalidateDeps = useRef(false);
  const getWaitPromise = (withTimeout = true) => {
    if (waitPromise.current) {
      return waitPromise.current;
    }
    return new Promise((resolve) => {
      const abort = () => {
        waitPromise.current = undefined;
        resolve();
      };
      abortWait.current = abort;
      if (withTimeout) {
        timeoutRef.current = setTimeout(abort, 5000);
      }
    });
  };
  useEffect(() => {
    // dependencies have changed, invalidate the chain reaction
    invalidateDeps.current = true;
    useDeps.current = deps;
    if (abortWait.current) {
      // skip the polling delay
      abortWait.current();
    }
  }, [deps]);
  useEffect(() => {
    // start the generator
    if (generator.current) {
      // remove the old generator, as the chemical declaration has changed
      generator.current.return();
    }
    generator.current = catalyze(chemical);
    generator.current.next();
    const iterate = async () => {
      while (true) {
        if (!generator.current || !mounted.current) {
          // abort on unmount or change in dependencies
          return;
        }
        if (invalidateDeps.current) {
          invalidateDeps.current = false;
          // throw away the next value
          // passing in new dependencies will reset the
          // reaction generator to the beginning of the chain on the
          // next call
          await generator.current.next(useDeps.current);
        }
        // if the last call was with new dependencies,
        // this will be the first with the new deps
        const nextProps = await generator.current.next(useDeps.current);
        if (nextProps.done) {
          // abort on generator conclusion (component unmount)
          return;
        }
        if (nextProps.value) {
          setProps(nextProps.value);
        }
        if (nextProps.value[0] === "finished") {
          // wait 5 seconds, or for the next dependency change
          await getWaitPromise();
        }
        if (nextProps.value[0] === "error") {
          await getWaitPromise(
            false /* don't time out, resolve on dependency change */
          );
        }
      }
    };
    iterate();
  }, [chemical]);
  useEffect(() => {
    return () => {
      mounted.current = false;

      // disable the generator on unmount
      if (generator.current) {
        generator.current.return();
      }
    };
  }, []);
  return props as [ChainReactionState, Partial<ResourceShape>];
}
