/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { expect, test } from "vitest";
import App from "./App";

test("renders file controls with canvas", () => {
  render(<App />);

  expect(screen.getByText(/файл/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /экспортировать как/i })).toBeInTheDocument();
  expect(document.getElementById("myCanvas")).toBeInTheDocument();
});
