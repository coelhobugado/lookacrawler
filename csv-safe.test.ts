import { describe, expect, test } from "bun:test";
import { EXCEL_PT_BR, sanitizeCsvCell, sanitizeCsvRow, toSafeCsv } from "./csv-safe.js";

describe("CSV Safety & Formula Injection Prevention (csv-safe.ts)", () => {
  test("should prefix formula triggers (=, +, -, @, \\t, \\r) with an apostrophe", () => {
    expect(sanitizeCsvCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
    expect(sanitizeCsvCell("+12345")).toBe("'+12345");
    expect(sanitizeCsvCell("-50")).toBe("'-50");
    expect(sanitizeCsvCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
    expect(sanitizeCsvCell("\tmalicious")).toBe("'\tmalicious");
  });

  test("should leave safe strings, numbers, and empty values untouched", () => {
    expect(sanitizeCsvCell("Lucas Martins")).toBe("Lucas Martins");
    expect(sanitizeCsvCell("contato@lookadev.com")).toBe("contato@lookadev.com");
    expect(sanitizeCsvCell(1234)).toBe("1234");
    expect(sanitizeCsvCell(null)).toBe("");
    expect(sanitizeCsvCell(undefined)).toBe("");
    expect(sanitizeCsvCell("")).toBe("");
  });

  test("should keep numeric cells as numbers, including negative coordinates", () => {
    expect(sanitizeCsvCell(-16.6869)).toBe("-16.6869");
    expect(sanitizeCsvCell(-49.2648)).toBe("-49.2648");

    const csvOutput = toSafeCsv(["Title", "Latitude", "Longitude"], [["Clínica", -16.6869, -49.2648]]);
    expect(csvOutput).toBe("Title,Latitude,Longitude\r\nClínica,-16.6869,-49.2648");
  });

  test("should correctly sanitize an entire row array", () => {
    const rawRow = ["=SUM(A1)", "Normal Text", "@danger"];
    const sanitized = sanitizeCsvRow(rawRow);
    expect(sanitized).toEqual(["'=SUM(A1)", "Normal Text", "'@danger"]);
  });

  test("should format full CSV with quotes around fields with commas or quotes", () => {
    const headers = ["Name", "Payload", "City"];
    const rows = [
      ["Empresa Alpha, S/A", "=calc", "São Paulo"],
      ["Beta Tech", 'Quote "Inside"', "Rio de Janeiro"],
    ];

    const csvOutput = toSafeCsv(headers, rows);
    expect(csvOutput).toContain('"Empresa Alpha, S/A"');
    expect(csvOutput).toContain("'=calc");
    expect(csvOutput).toContain('"Quote ""Inside"""');
  });
});

describe("CSV output for Excel pt-BR", () => {
  test("defaults stay comma-delimited without BOM", () => {
    const csv = toSafeCsv(["A", "B"], [["x;y", 1.5]]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv).toBe("A,B\r\nx;y,1.5");
  });

  test("semicolon delimiter quotes fields that contain it", () => {
    const csv = toSafeCsv(["Nome", "Endereço"], [["Clínica; Centro", "Rua A, 10"]], { delimiter: ";" });
    expect(csv).toBe('Nome;Endereço\r\n"Clínica; Centro";Rua A, 10');
  });

  test("Excel preset adds BOM, semicolons and decimal commas while keeping formula protection", () => {
    const csv = toSafeCsv(["Título", "Lat", "Nota"], [["=HYPERLINK(1)", -16.6869, "4.5"]], EXCEL_PT_BR);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("Título;Lat;Nota\r\n'=HYPERLINK(1);-16,6869;4.5");
  });
});
