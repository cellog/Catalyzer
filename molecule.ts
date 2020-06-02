export type Atom<
  Model = unknown,
  Props = unknown,
  Loads = Promise<Model | undefined>
> = (props: Props) => Loads;

/**
 * The core of the chain reaction API: a molecule is a directed graph of
 * server fetches to perform, represented as an array. The traversal starts
 * at the beginning of the array and goes to its end. Each atom group in the array
 * represents a set of fetches that can be performed in parallel.
 *
 * Later atom groups may depend upon results fetched by earlier atom groups.
 *
 * As an example: when fetching a design workflow, we also need to fetch its
 * design space and predictor, but cannot do so until we know which ones to fetch.
 * This information is stored inside the design workflow's config. Once the workflow
 * is resolved, we can fetch the design space and predictor in parallel. This Molecule
 * could look like:
 *
 * [
 *   {
 *     designWorkflow: async ({ projectId, workflowId }: { projectId?: string, workflowId?: string }) => {
 *       return projectId && workflowId ?
 *         getDesignWorkflowClient(projectId).get(workflowId) : undefined;
 *     },
 *   },
 *   {
 *     designSpace: async ({ projectId, designWorkflow }: { projectId?: string, designWorkflow?: IWorkflow }) => {
 *       return projectId && designWorkflow ?
 *         getDesignSpaceClient(projectId).get(designWorkflow.config.design_space_id) : undefined;
 *     },
 *     predictor: async ({ projectId, designWorkflow }: { projectId?: string, designWorkflow?: IWorkflow }) => {
 *       return projectId && designWorkflow ?
 *         getPredictorClient(projectId).get(designWorkflow.config.predictor) : undefined;
 *     },
 *   }
 * ]
 */
export type Molecule = {
  [key: string]: Atom;
}[];

/**
 * This is used both to pass external dependencies into the chain reaction, and
 * to return the fetched resources.
 *
 * External dependencies example: { projectId: "...", workflowId: "..." }
 */
export interface MoleculeProps {
  [key: string]: any;
}

/**
 * A value can exist in 5 states:
 * - undefined
 * - Pending
 * - Error
 * - Resolved
 * - Refreshing
 *
 * The first 3 are easily understandable
 *
 * The last is a value that has been previously retrieved, but is now
 * being retrieved again from the server, most commonly in a polling context.
 * When a value is refreshing, it is represented as a `Promise`, with the
 * most-recently-retrieved value in the `previousValue` property of the Promise
 */
export type AtomValue<T> = Promise<T> | Error | T | undefined;

/**
 * This is used to represent the fetched resources yielded by `reaction`
 *
 * a fetched resource example based on the above Molecule: {
 *   designWorkflow: <an IWorkflow>,
 *   designSpace: <a Promise that will resolve to a design space>
 *   predictor: <an Error that was thrown during fetch>
 * }
 */
export type AtomState<Props extends MoleculeProps> = {
  [Key in keyof Props]?: AtomValue<Props[Key]>;
};

/**
 * Execute a chain reaction to retrieve server resources in sequence and in parallel
 *
 * Don't use this direclty, but instead call from `catalyze`, or in a React
 * context, `useResources`
 * @param molecule
 */
export async function* reaction(molecule: Molecule) {
  let props: MoleculeProps = {};
  while (true) {
    const nextProps: MoleculeProps = yield props;
    for (const group of molecule) {
      const mergedProps = { ...nextProps, ...props };

      const newProps = await executeGroup(group, mergedProps);
      // first yield the promises as they are
      yield newProps;
      props = { ...newProps };
      let hasErrors = false;
      for (const [key, prop] of Object.entries(props)) {
        // resolve/reject the promises
        props[key] =
          prop instanceof Promise ? await prop.catch((e: Error) => e) : prop;
        if (props[key] instanceof Error) {
          // terminate after this group, we can't continue if
          // any dependencies don't resolve
          hasErrors = true;
        }
      }
      // yield the resolved values, and continue with the next group
      yield props;
      if (hasErrors) {
        // stop the chain if there ar errors
        break;
      }
    }
  }
}

/**
 * Used internally to detect a promise that is concluded but not converted to
 * its value when passing dependencies to the next atom group
 *
 * It can also be used by the end user to detect a value that is resolved or
 * is refreshing
 */
export function isResolved<T>(a: any): a is T | Promise<T> {
  if (a === undefined) {
    return false;
  }
  if (isRejected(a) || (isPending(a) && !isRefreshing(a))) {
    return false;
  }
  return true;
}

/**
 * Used internally to detect a promise that is not yet finished
 *
 * This can also be used by the end user
 */
export function isPending(a: any): a is Promise<any> {
  return a instanceof Promise && !(a as any).rejected && !a.resolved;
}

/**
 * Used internally to detect a promise that has rejected, or been converted to an Error already
 *
 * This can also be used by the end user
 */
export function isRejected<T>(a: any): a is Error | Promise<T> {
  return a instanceof Error || (a instanceof Promise && !!a.rejected);
}

/**
 * For end users, can be used to detect a value that exists but is being refreshed
 */
export function isRefreshing<T>(a: any): a is Promise<T> {
  return isPending(a) && a.previousValue;
}

/**
 * retrieve the value of an atom, or undefined if it is an error or pending
 */
export function resolvedValue<T>(a: AtomValue<T>): T | undefined {
  if (isRefreshing(a)) {
    return a.previousValue!;
  }
  if (isPending(a) || isRejected(a)) {
    return undefined;
  }
  return a;
}

declare global {
  /**
   * These augmentations to the properties of a Promise make it possible to
   * assert on the state of a promise without using .then/.catch
   */
  interface Promise<T> {
    rejected?: true;
    resolved?: true;
    // when a promise is refreshing, we store the most recent resolution here
    previousValue?: T;
  }
}

/**
 * Augment a promise to be able to quickly tell if it is resolved or rejected
 */
function augmentPromise<T>(p: Promise<T>) {
  return p
    .then((t: T) => {
      p.resolved = true;
      return t;
    })
    .catch((e: Error) => {
      p.rejected = true;
      return Promise.reject(e);
    });
}

/**
 * Helper function used by reaction to execution an atom group
 *
 * resource chains are organized into groups of "atoms" that should be retrieved in parallel
 *
 * This function executes that retrieval. Unlike Promise.all(), this responds to
 * previous context, passing previously resolved values into the atoms
 * @param group
 * @param previousProps
 */
async function executeGroup(
  group: Molecule[number],
  previousProps: MoleculeProps
) {
  const props = {
    ...previousProps,
  };
  // first, convert any resolved promises to their resolution
  // and rejected promises to their error
  for (const [key, prop] of Object.entries(props)) {
    if (isRejected(prop)) {
      // preserve errors, don't re-request
      props[key] = prop instanceof Error ? prop : await prop.catch((e) => e);
      continue;
    }
    if (isResolved(prop)) {
      props[key] = prop instanceof Promise ? await prop : prop;
    }
  }
  // then, call the atoms
  for (const [key, atom] of Object.entries(group)) {
    if (props[key] && props[key] instanceof Error) {
      // don't re-execute an endpoint that already failed
      continue;
    }
    const promise = augmentPromise(atom(props));
    if (isResolved(props[key])) {
      // we have a previous value
      promise.previousValue = props[key];
    }
    props[key] = promise;
  }
  return props;
}
