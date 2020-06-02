import * as rtl from "@testing-library/react";
import React, { useState, useEffect } from "react";
import { useResources } from "./useResources";
import { Molecule, isRejected, isPending } from "./molecule";

describe("useResources hook", () => {
  function MockResources<Atoms extends Molecule>({
    chemical,
    projectId,
    workflowId,
  }: {
    chemical: Atoms;
    projectId?: string;
    workflowId?: string;
  }) {
    const [props, setProps] = useState({ projectId, workflowId });
    const [resourceState, resources] = useResources<{
      designWorkflow: { thing: string };
      predictor: { thing: string };
      designSpace: { thing: string };
    }>(chemical, props);
    useEffect(() => {
      setProps({ projectId, workflowId });
    }, [projectId, workflowId]);
    const getState = (item: typeof resources.designWorkflow) => {
      if (item === undefined) {
        return "not loaded";
      }
      if (isRejected(item)) {
        return "rejected";
      }
      if (isPending(item)) {
        if (item.previousValue) {
          return "refreshing";
        }
        return "pending";
      }
      return "resolved";
    };

    return (
      <div>
        <div data-testid="state">{resourceState}</div>
        <div data-testid="workflow-state">
          {getState(resources.designWorkflow)}
        </div>
        <div data-testid="predictor-state">{getState(resources.predictor)}</div>
        <div data-testid="designSpace-state">
          {getState(resources.designSpace)}
        </div>
        <div data-testid="workflow-value">
          {JSON.stringify({ value: resources.designWorkflow })}
        </div>
        <div data-testid="predictor-value">
          {JSON.stringify({ value: resources.predictor })}
        </div>
        <div data-testid="designSpace-value">
          {JSON.stringify({ value: resources.designSpace })}
        </div>
      </div>
    );
  }

  it("should be finished and have all values present when an initial poll is over", async () => {
    let wrapper: ReturnType<typeof rtl.render> = (1 as unknown) as ReturnType<
      typeof rtl.render
    >;
    await rtl.act(async () => {
      wrapper = rtl.render(
        <MockResources
          chemical={[
            {
              designWorkflow: async () => ({ thing: "workflow" }),
            },
            {
              predictor: async () => ({ thing: "predictor" }),
              designSpace: async () => ({ thing: "design space" }),
            },
          ]}
        />
      );
    });
    expect(wrapper.getByTestId("state")).toHaveTextContent("finished");
    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("resolved");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "resolved"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "resolved"
    );
    expect(wrapper.getByTestId("workflow-value")).toHaveTextContent(
      JSON.stringify({
        value: { thing: "workflow" },
      })
    );
    expect(wrapper.getByTestId("predictor-value")).toHaveTextContent(
      JSON.stringify({
        value: { thing: "predictor" },
      })
    );
    expect(wrapper.getByTestId("designSpace-value")).toHaveTextContent(
      JSON.stringify({
        value: { thing: "design space" },
      })
    );
  });

  it("should render intermediate steps", async () => {
    // this test triggers 3 console.error
    // it is impossible to test the intermediate steps within
    // rtl.act, and without rtl.act, the warnings are thrown

    const move = () => new Promise((resolve) => setTimeout(resolve));
    let resolveDesignWorkflow: any;
    let resolvePredictor: any;
    let resolveDesignSpace: any;
    const wrapper = rtl.render(
      <MockResources
        chemical={[
          {
            designWorkflow: () =>
              new Promise((resolve) => {
                resolveDesignWorkflow = () => resolve({ thing: "workflow" });
              }),
          },
          {
            predictor: () =>
              new Promise((resolve) => {
                resolvePredictor = () => resolve({ thing: "predictor" });
              }),
            designSpace: () =>
              new Promise((resolve) => {
                resolveDesignSpace = () => resolve({ thing: "design space" });
              }),
          },
        ]}
      />
    );
    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("state")).toHaveTextContent("executing");
    expect(wrapper.getByTestId("workflow-value")).toHaveTextContent(
      JSON.stringify({
        value: undefined,
      })
    );
    expect(wrapper.getByTestId("predictor-value")).toHaveTextContent(
      JSON.stringify({
        value: undefined,
      })
    );
    expect(wrapper.getByTestId("designSpace-value")).toHaveTextContent(
      JSON.stringify({
        value: undefined,
      })
    );

    await rtl.wait(() => resolveDesignWorkflow);
    resolveDesignWorkflow();

    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("pending");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "not loaded"
    );

    await move();
    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("resolved");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent("pending");
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "pending"
    );

    await rtl.wait(() => resolveDesignSpace && resolvePredictor);

    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("resolved");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent("pending");
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "pending"
    );
    expect(wrapper.getByTestId("workflow-value")).toHaveTextContent(
      JSON.stringify({
        value: { thing: "workflow" },
      })
    );
    resolvePredictor();
    resolveDesignSpace();

    await move();
    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("resolved");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "resolved"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "resolved"
    );
    expect(wrapper.getByTestId("predictor-value")).toHaveTextContent(
      JSON.stringify({
        value: { thing: "predictor" },
      })
    );
    expect(wrapper.getByTestId("designSpace-value")).toHaveTextContent(
      JSON.stringify({
        value: { thing: "design space" },
      })
    );
    expect(wrapper.getByTestId("state")).toHaveTextContent("finished");
  });

  it("should avoid tearing by re-starting fetch if dependencies change", async () => {
    // this test triggers 3 console.error
    // it is impossible to test the intermediate steps within
    // rtl.act, and without rtl.act, the warnings are thrown

    const move = () => new Promise((resolve) => setTimeout(resolve));
    let resolveDesignWorkflow: any;
    const chemical: Molecule = [
      {
        designWorkflow: () =>
          new Promise((resolve) => {
            resolveDesignWorkflow = () => resolve({ thing: "workflow" });
          }),
      },
      {
        predictor: () => Promise.resolve({ thing: "predictor" }),
        designSpace: () => Promise.resolve({ thing: "design space" }),
      },
    ];
    const wrapper = rtl.render(<MockResources chemical={chemical} />);
    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("state")).toHaveTextContent("executing");
    expect(wrapper.getByTestId("workflow-value")).toHaveTextContent(
      JSON.stringify({
        value: undefined,
      })
    );
    expect(wrapper.getByTestId("predictor-value")).toHaveTextContent(
      JSON.stringify({
        value: undefined,
      })
    );
    expect(wrapper.getByTestId("designSpace-value")).toHaveTextContent(
      JSON.stringify({
        value: undefined,
      })
    );

    await rtl.wait(() => resolveDesignWorkflow);
    resolveDesignWorkflow();

    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("pending");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "not loaded"
    );

    resolveDesignWorkflow = undefined;
    // invalidate dependencies
    wrapper.rerender(
      <MockResources chemical={chemical} projectId="invalidate that sucker" />
    );
    await move();
    expect(wrapper.getByTestId("workflow-state")).toHaveTextContent("pending");
    expect(wrapper.getByTestId("predictor-state")).toHaveTextContent(
      "not loaded"
    );
    expect(wrapper.getByTestId("designSpace-state")).toHaveTextContent(
      "not loaded"
    );
  });
});
