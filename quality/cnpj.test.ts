import { describe, expect, test } from "bun:test";
import { computeCnpjCheckDigits, extractCnpjs, formatCnpj, isValidCnpj, normalizeCnpj } from "./cnpj.js";

// Vectors from the Receita Federal reference code for the alphanumeric CNPJ
// (codigos-cnpj.zip, published with the "Manual de Cálculo do DV do CNPJ").
describe("CNPJ check digits (quality/cnpj.ts)", () => {
  test("official check digit examples", () => {
    expect(computeCnpjCheckDigits("12.ABC.345/01DE")).toBe("35");
    expect(computeCnpjCheckDigits("000000000001")).toBe("91");
    expect(computeCnpjCheckDigits("1345C3A50001")).toBe("06");
    expect(() => computeCnpjCheckDigits("12ABc34501DE")).toThrow();
    expect(() => computeCnpjCheckDigits("00000000000")).toThrow();
  });

  test("official valid examples", () => {
    for (const cnpj of [
      "12.ABC.345/01DE-35",
      "12ABC34501DE35",
      "1345C3A5000106",
      "ABCDEFGHIJKL80",
      "90.021.382/0001-22",
      "90.024.778/0001-23",
      "90.025.108/0001-21",
      "90.025.255/0001-00",
      "04.740.714/0001-97",
      "44.108.058/0001-29",
      "00000000000191",
    ]) {
      expect(isValidCnpj(cnpj)).toBe(true);
    }
  });

  test("official invalid examples", () => {
    for (const cnpj of [
      "",
      "'!@#$%&*-_=+^~",
      "$0123456789ABC",
      "12.ABc.345/01DE-35",
      "0000000000019",
      "000000000001911",
      "0000000000019L",
      "000000000001P1",
      "00000000000192",
      "ABCDEFGHIJKL81",
      "R55231B3000700",
      "90.025.108/000101",
      "00.000.000/0000-00",
    ]) {
      expect(isValidCnpj(cnpj)).toBe(false);
    }
  });

  test("rejects repeated-character filler", () => {
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });

  test("normalizes and formats", () => {
    expect(normalizeCnpj("12.ABC.345/01DE-35")).toBe("12ABC34501DE35");
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(formatCnpj("04740714000197")).toBe("04.740.714/0001-97");
    expect(formatCnpj("123")).toBe("123");
  });
});

describe("CNPJ extraction from page text", () => {
  test("finds masked and unmasked CNPJs and keeps only valid ones", () => {
    const footer =
      "Empresa Exemplo LTDA - CNPJ: 04.740.714/0001-97 | Filial 44108058000129 | " +
      "Novo: 12.ABC.345/01DE-35 | Inválido: 90.025.108/0001-01 | Tel (62) 3333-4444";
    expect(extractCnpjs(footer)).toEqual(["04740714000197", "44108058000129", "12ABC34501DE35"]);
  });

  test("requires a label for bare alphanumeric tokens", () => {
    expect(extractCnpjs("build ABCDEFGHIJKL80 done")).toEqual([]);
    expect(extractCnpjs("CNPJ ABCDEFGHIJKL80")).toEqual(["ABCDEFGHIJKL80"]);
  });

  test("does not match inside longer tokens", () => {
    expect(extractCnpjs("id=904740714000197x")).toEqual([]);
  });
});
