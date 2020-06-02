# Reactions Resource Retrieval Library

This is a set of tools for retrieving a complex tree of resources from the server.
It supports polling natively, and uses a declarative syntax for the resource
retrieval definition. The implementation only requires that resource retrieval
be implemented using functions that return Promises, and is otherwise library-agnostic.

## Concepts

The library borrows from chemistry to describe its components. The components are
atoms, molecules, and reactions.

A React interface to these components is provided through the `useResources`
hook.

### Atoms

Atoms are pure functions that accept input and return a promise that will resolve
to a resource, or reject with an error. The function should accept a single
argument which is a map object similar to the `props` argument to a React
functional component

```ts
const atom = async ({ projectId }: { projectId?: string }) => {
  if (!projectId) {
    return undefined;
  }
  const client = getProjectClient();
  return client.get(projectId);
}
```

Atoms can respond to the results from other atoms that have been triggered
earlier in the chain reaction:

```ts
const atom = async ({
  projectId,
  designWorkflow,
}: {
  projectId?: string;
  designWorkflow?: IWorkflow
}) => {
  if (!projectId || !designWorkflow) {
    return undefined;
  }
  const predictorClient = getPredictorClient(projectId);
  return predictorClient.get(designWorkflow.config.predictor_id);
}
```

Any dependencies passed in to a reaction are not guaranteed to exist.

Note that if an atom cannot execute due to missing external dependencies, then

### Atom groups

Atom groups are a keyed object mapping a name to an atom. These atoms will be executed in parallel

```ts
const atomGroup = {
  designWorkflow: ({ projectId }: { projectId?: string }) => {
    if (!projectId) {
      return undefined;
    }
    const client = getDesignWorkflowClient();
    return client.get(projectId);
  },
  predictors: ({ projectId }: { projectId?: string }) => {
    if (!projectId) {
      return undefined;
    }
    const client = getPredictorsClient();
    return client.find();
  },
}
```

### Molecules

Molecules are an array of atom groups. They represent a sequential path of execution,
as well as a dependency graph. Execution begins with the first group in the array,
and continues in sequence until the last group has executed, passing the results of the
previous group as input to the atoms of the subsequent groups.

When an error occurs, execution stops. This ensures that when a dependency is not
satisfied due to an error, the chain reaction halts.

```ts
const molecule = [
  {
    designWorkflow: ({ projectId }: { projectId?: string }) => {
      if (!projectId) {
        return undefined;
      }
      const client = getDesignWorkflowClient();
      return client.get(projectId);
    },
    predictors: ({ projectId }: { projectId?: string }) => {
      if (!projectId) {
        return undefined;
      }
      const client = getPredictorsClient();
      return client.find();
    },
  },
  {
    predictor: async ({
        projectId,
        designWorkflow,
      }: {
        projectId?: string;
        designWorkflow?: IWorkflow
      }) => {
        if (!projectId || !designWorkflow) {
          return undefined;
        }
        const predictorClient = getPredictorClient(projectId);
        return predictorClient.get(designWorkflow.config.predictor_id);
      },
    designSpace: async ({
        projectId,
        designWorkflow,
      }: {
        projectId?: string;
        designWorkflow?: IWorkflow
      }) => {
        if (!projectId || !designWorkflow) {
          return undefined;
        }
        const designSpaceClient = getDesignSpaceClient(projectId);
        return designSpaceClient.get(designWorkflow.config.design_space_id);
      },
  }
}
```

### Reactions

Reactions are the method of traversing through a molecule to retrieve resources.
Reactions are implemented through the `catalyze` generator function.

```ts
async function demo() {
  const deps = { projectId: "my project" };

  const generator = catalyze(molecule);

  while (true) {
    const [state, resources] = await generator.next(deps);
  }
}
```

The generator will yield values the instant an atom group begins execution in order
to track pending state. After the group resolves, it will yield the resources/errors.

This will continue until the chain reaction has concluded.

The state value refers to the reaction, and is one of `"normal"`, `"error"`, or `"finished"`.
Individual results from the atoms are their own miniature state machines,
represented as 5 possible states by their types:

- undefined
- Promise or refreshing Promise
- Error
- other

If `undefined`, the fetch is not yet possible to execute, due to missing
dependencies.
If `Error`, then an unrecoverable error occurred during execution of an atom
If `Promise`, then the fetch is either pending, or if the `previousValue` property
exists, then a refresh fetch is pending.
Everything else is a successful fetch.

The helper functions `isRejected`, `isResolved`, `isPending`, `isRefreshing` can be used to
determine which state the atom is in if it is not `undefined`.

In addition, the `resolveValue` helper function can be used to retrieve the resolved
value of an atom whether or not it is currently refreshing.

```ts
async function demo() {
  const deps = { projectId: "my project" };

  const generator = catalyze(molecule);

  while (true) {
    const [state, resources] = await generator.next(deps);

    if (state === "error") {
      // process the individual errors triggered
      const errors = Object.entries(resources).filter(([key, value]) =>
        isRejected(value));
      // or
      throw new Error("fetching resources failed");
    }

    // work with a specific resource
    if (isPending(resources.predictor)) {
      // show spinner
    }
    if (isResolved(resources.predictor)) {
      // avoid showing a spinner every 5 seconds with this
      const value = resolveValue(resource.predictor);
    }
    if (resources.predictor === undefined) {
      // predictor couldn't load because of a missing depednency
    }
  }
}
```

### Polling

Reactions poll every 5 seconds after a chain reaction successfully finishes
executing the entire molecule.

If an error occurs, polling will permanently stop.

Atoms can turn on or off polling based on previous state

```ts
const molecule: Molecule = [
  {
    designWorkflow: async ({
      projectId,
      workflowId
    }: {
      projectId?: string;
      workflowId?: string;
      designWorkflow?: IWorkflow;
    }) => {
      // irrelevant details omitted
      if (designWorkflow && (designWorkflow.status === "CREATED" || designWorkflowState === "VALIDATING")) {
        // skip cache
        return getDesignWorkflowClient(projectId).get(workflowId, { forceFetch: true });
      }
    },
  }
]
```

### Avoiding race conditions

Loading a chain of resources takes a non-zero amount of time. It is conceivable
and even likely in many cases that a user may decide to navigate to a different
set of dependencies before a chain reaction has finished.

In this case, `catalyze` will simply discard the existing chain and begin
again from scratch. No further action need be taken.

## API

### useResources

When interacting with a `Molecule` chain in a React context, use the
`useResources` hook.

This hook accepts 2 arguments, the `Molecule` to execute, and the current
dependencies. It returns a tuple of `[state, resources]` and will trigger
a re-render any time the resources are updated.

```ts
import { useResources } from "src/generators/useResources";

const SomeComponents = () => {
  const { projectId, workflowId } = useParams();

  // it is crucial to pass in the same object for dependencies unless it has changed
  const deps = useRef({ projectId, workflowId });
  useEffect(() => {
    deps.current = { projectId, workflowId };
  }, [projectId, workflowId]);
  const [state, resources] = useResources<{
    designWorkflow: IWorkflow,
    predictor: IPredictor<IPredictorConfig>,
    designSpace: IDesignSpace<IDesignSpaceConfig>,
  }>([
    { designWorkflow: loadDesignWorkflow },
    {
      predictor: loadPredictor,
      designSpace: loadDesignSpace,
    }
  ], deps.current);
}
```

### catalyze

`catalyze` is the primary user-facing means of interacting with a `Molecule` chain. It provides
the execution and polling needed to work, as well as invalidation of the chain
when dependencies change. As an async generator, it must be initialized
with a dummy call to `next()` before it will begin accepts dependencies.

```ts
import { Molecule } from "src/generators/molecule";
import { catalyze } from "src/generators/catalyze";
// see the definition above of a molecule
const molecule: Molecule = [...];
const generator = catalyze(molecule);
// start the generator
generator.next();
const dependencies = { projectId: "project id" };
let props: MoleculeProps = {}
while (true) {
  const next = await generator.next(dependencies);
  const [state, resources] = next.value;
}
```

### reaction

`reaction` is the low-level catalyzing function that transforms individual atoms joined
into `Molecule`s into a chain reaction of server fetches.

In other words, it is the core of the API. As an async generator, it must be initialized
with a dummy call to `next()` before it will begin accepts dependencies.

```ts
import { Molecule, reaction } from "src/generators/molecule";
// see the definition above of a molecule
const molecule: Molecule = [...];
const generator = reaction(molecule);
// start the generator
generator.next();

const dependencies = { projectId: "project id" };
let props: MoleculeProps = {}
while (true) {
  const next = await generator.next({ ...props, ...dependencies });
  props = next.value;
}
```