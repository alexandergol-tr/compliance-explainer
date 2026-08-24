"""Recalculate the generated NM workbook and assert the product outcomes.

Runs the real Excel formulas through the `formulas` engine, so a broken lookup or a
mis-wired knockout fails here rather than in front of a user.

    python verify_nm_workbook.py            # every case, every regulation tab
    python verify_nm_workbook.py "FCA v15"  # only cases that run on that tab

Cell addresses are resolved by scanning labels rather than hardcoded, so a tab can be
re-laid-out without silently invalidating these checks.
"""

import re
import sys

import formulas
from openpyxl import load_workbook

BOOK = "eToro-negative-market-calculator.xlsx"

CYSEC = "CySEC v24"
FCA = "FCA v15"
ASIC = "ASIC v9"
GAML = "ASIC GAML v15"
FSRA = "FSRA v10"
MAS = "MAS v12"
SHEETS = [CYSEC, FCA, ASIC, GAML, FSRA, MAS]

# Column-F "config question" tag -> logical input name. These tags are printed next to
# every yellow input cell on the tabs.
INPUT_TAGS = {
    "RiskAppetite": "RiskAppetite", "AnnualIncome": "AnnualIncome",
    "LiquidAssets": "LiquidAssets", "TradingPurpose": "TradingPurpose",
    "IncomeSource": "IncomeSource", "Occupation": "Occupation",
    "Crypto": "Crypto", "LeveragedCfd": "LeveragedCfd",
    "TradingKnowledge": "TradingKnowledge",
    "HaveYouTransactedCFD": "HaveYouTransactedCFD",
    "CkaTradingKnowledge": "CkaTradingKnowledge",
    "MinCount 3 to rescue": "SetX",   # two rows share this tag; handled specially below
    "MinTotalScore 5": "UkVerity",
    "IConfirmExposeHighNetWorthInvestor": "UkHNW",
    "IConfirmExposeSophisticatedInvestor": "UkSoph",
    "CkaAcademicQualification (see Rules)": "MasDegree",
    "CkaProfessionalCertificate (see Rules)": "MasCert",
    "CkaWorkExperience (see Rules)": "MasWork",
    "HaveYouTransactedEtf": "HaveYouTransactedEtf",
    "CarAcademicQualification (see Rules)": "CarDegree",
    "CarProfessionalCertificate (see Rules)": "CarCert",
    "CarWorkExperience (see Rules)": "CarWork",
}

# labels as they appear in the dropdowns (must match build_nm_workbook.py)
L = {
    "risk5": "5% / -3%", "risk10": "10% / -6%", "risk20": "20% / -12%",
    "inc_up10": "Up to 10K", "inc_50_200": "50K - 200K", "inc_10_50": "10K - 50K",
    "never": "Never traded", "traded": "Traded before",
    "no_know": "No financial knowledge", "courses": "Trading courses",
    "pension": "Pension", "salary": "Salary",
    "saving": "Saving for a home", "employed": "Employed", "retired": "Retired",
}


# ASIC GAML CFD & Futures Typeform inputs share a column-F tag ("... KO on a red answer"),
# so they are located by the "Qn" prefix of their column-B question label.
TF_NUM = {
    1: "tf_leverage", 2: "tf_loseall", 3: "tf_distress", 4: "tf_hardship",
    5: "tf_margincall", 6: "tf_purpose", 7: "tf_ownership", 8: "tf_cfd_duration",
    9: "tf_fut_margin", 10: "tf_fut_timeframe", 11: "tf_fut_monitor",
}


def locate(sheet):
    ws = load_workbook(BOOK)[sheet]
    inputs = {}
    quiz_cells = {}
    results = {}     # product title -> E cell
    days_cell = trades_cell = None
    seen_setx = 0

    rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=6))
    for row in rows:
        b = row[1].value if len(row) > 1 else None
        c_row = row[0].row
        f = row[5].value if len(row) > 5 else None
        # inputs identified by their column-F tag
        if isinstance(f, str) and f in INPUT_TAGS:
            name = INPUT_TAGS[f]
            if name == "SetX":
                seen_setx += 1
                name = "SetA" if seen_setx == 1 else "SetB"
            inputs.setdefault(name, f"C{c_row}")
        # quiz Yes/No rows carry the config name in column F
        if isinstance(f, str) and f.startswith("Newer"):
            quiz_cells[f] = f"C{c_row}"
        # Typeform inputs: column-F ends with "KO on a red answer"; key by the "Qn" prefix.
        if isinstance(f, str) and f.endswith("KO on a red answer") and isinstance(b, str):
            m = re.match(r"Q(\d+)\b", b)
            if m and int(m.group(1)) in TF_NUM:
                inputs.setdefault(TF_NUM[int(m.group(1))], f"C{c_row}")
        if isinstance(b, str):
            if b == "Days since first-time deposit":
                days_cell = f"C{c_row}"
            elif b == "Closed trades since FTD":
                trades_cell = f"C{c_row}"
            elif b.endswith(": result"):
                results[b[:-len(": result")]] = f"E{c_row}"
    return {"inputs": inputs, "quiz": quiz_cells, "results": results,
            "days": days_cell, "trades": trades_cell}


QUIZ_TRUE = ["NewerLeverage", "NewerMarginCall"]      # +2 statements
QUIZ_FALSE = ["NewerCfd", "NewerStopLossTrigger", "NewerStopLossGapThrough", "NewerCfdTrs"]


def quiz(*ticked):
    """Yes/No per statement. Returns dict config-name -> Yes/No."""
    names = QUIZ_TRUE + QUIZ_FALSE
    return {n: ("Yes" if n in ticked else "No") for n in names}


# Quiz that scores well above the -3 cutoff: tick both true statements only -> +12.
QUIZ_PASS = quiz("NewerLeverage", "NewerMarginCall")
# Quiz that fails hard: tick every false statement, no true ones -> well below -3.
QUIZ_FAIL = quiz(*QUIZ_FALSE)


CASES = [
    # ---- CFD knockout by appetite -----------------------------------------
    {"name": "CySEC blocks CFD on lowest appetite", "sheet": CYSEC,
     "inputs": {"RiskAppetite": L["risk5"]},
     "expect": {"CFD": "BLOCKED"}},
    {"name": "CySEC blocks CFD on lowest income", "sheet": CYSEC,
     "inputs": {"AnnualIncome": L["inc_up10"]},
     "expect": {"CFD": "BLOCKED", "Futures": "BLOCKED", "Margin (SMT)": "BLOCKED"}},
    {"name": "CySEC does not block a mid-range experienced user", "sheet": CYSEC,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD": "Not blocked", "Futures": "Not blocked", "Margin (SMT)": "Not blocked"}},

    # ---- experience rule (nested rescue) ----------------------------------
    {"name": "CySEC blocks the inexperienced user who also fails the quiz", "sheet": CYSEC,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "Crypto": L["never"], "LeveragedCfd": L["never"],
                "TradingKnowledge": L["no_know"], "SetA": 0, "SetB": 0},
     "quiz": QUIZ_FAIL,
     "expect": {"CFD": "BLOCKED"}},
    {"name": "CySEC rescues the same user once a questionnaire passes 3/5", "sheet": CYSEC,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "Crypto": L["never"], "LeveragedCfd": L["never"],
                "TradingKnowledge": L["no_know"], "SetA": 3, "SetB": 0},
     "quiz": QUIZ_FAIL,
     "expect": {"CFD": "Not blocked"}},
    {"name": "CySEC experience block auto-releases at 60 days + 20 trades", "sheet": CYSEC,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "Crypto": L["never"], "LeveragedCfd": L["never"],
                "TradingKnowledge": L["no_know"], "SetA": 0, "SetB": 0},
     "quiz": QUIZ_FAIL, "days": 60, "trades": 20,
     "expect": {"CFD": "Not blocked"}},

    # ---- FCA extra low-means checks ---------------------------------------
    {"name": "FCA blocks the retired pensioner on the All-check even with a passing quiz",
     "sheet": FCA,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_10_50"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["pension"],
                "Occupation": L["retired"], "Crypto": L["traded"],
                "LeveragedCfd": L["traded"], "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD": "BLOCKED"}},
    {"name": "FCA passes an employed salaried user on the same means", "sheet": FCA,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Occupation": L["employed"], "Crypto": L["traded"],
                "LeveragedCfd": L["traded"], "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD": "Not blocked"}},

    # ---- ASIC (ASIC-9.json) -----------------------------------------------
    {"name": "ASIC blocks CFD on saving-for-a-home purpose", "sheet": ASIC,
     "inputs": {"RiskAppetite": L["risk20"], "TradingPurpose": L["saving"],
                "AnnualIncome": L["inc_50_200"], "LiquidAssets": L["inc_50_200"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD": "BLOCKED"}},
    {"name": "ASIC does not block the second-lowest appetite band when purpose is not saving-for-home",
     "sheet": ASIC,
     "inputs": {"RiskAppetite": L["risk10"], "TradingPurpose": "Additional revenues",
                "AnnualIncome": L["inc_50_200"], "LiquidAssets": L["inc_50_200"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD": "Not blocked"}},

    # ---- GAML (spreadsheet + ASICGAML-15.json) ----------------------------
    # Typeform answers default to passing; a case only sets the ones it wants to knock out.
    {"name": "GAML clean experienced user is not blocked on CFD or Futures",
     "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "Not blocked", "Futures": "Not blocked"}},
    {"name": "GAML blocks CFD and Futures when the only source of income is pension", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["pension"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "BLOCKED", "Futures": "BLOCKED"}},
    {"name": "GAML blocks CFD on the second-lowest appetite band (10%/-6%)", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk10"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "BLOCKED"}},
    {"name": "GAML Typeform CFD-only question blocks CFD but not Futures", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"],
                "tf_ownership": "Yes"},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "BLOCKED", "Futures": "Not blocked"}},
    {"name": "GAML Typeform Futures-only question blocks Futures but not CFD", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"],
                "tf_fut_monitor": "No"},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "Not blocked", "Futures": "BLOCKED"}},
    {"name": "GAML Typeform shared question (purpose = saving for a home) blocks both", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"],
                "tf_purpose": "Saving for a home or long term investment priorities"},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "BLOCKED", "Futures": "BLOCKED"}},
    {"name": "GAML Typeform futures margin-definition wrong answer blocks Futures", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk20"], "AnnualIncome": L["inc_50_200"],
                "LiquidAssets": L["inc_50_200"], "IncomeSource": L["salary"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"],
                "tf_fut_margin": "The total value of the contract"},
     "quiz": QUIZ_PASS,
     "expect": {"CFD (leveraged NMF)": "Not blocked", "Futures": "BLOCKED"}},
    {"name": "GAML widens experimental crypto to 10%/-6%", "sheet": GAML,
     "inputs": {"RiskAppetite": L["risk10"],
                "AnnualIncome": L["inc_50_200"], "LiquidAssets": L["inc_50_200"],
                "IncomeSource": L["salary"], "Crypto": L["traded"],
                "LeveragedCfd": L["traded"], "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"Experimental crypto": "BLOCKED"}},

    # ---- FSRA top-level crypto -------------------------------------------
    {"name": "FSRA blocks direct crypto on lowest appetite", "sheet": FSRA,
     "inputs": {"RiskAppetite": L["risk5"], "AnnualIncome": L["inc_50_200"],
                "Crypto": L["traded"], "LeveragedCfd": L["traded"],
                "TradingKnowledge": L["courses"]},
     "quiz": QUIZ_PASS,
     "expect": {"Crypto (direct trade)": "BLOCKED", "CFD": "BLOCKED"}},

    # ---- MAS CKA ----------------------------------------------------------
    {"name": "MAS blocks a user who never transacted and holds none of the three CKA criteria",
     "sheet": MAS,
     "inputs": {"HaveYouTransactedCFD": "No",
                "MasDegree": "No", "MasCert": "No", "MasWork": "No"},
     "expect": {"CFD (CKA)": "BLOCKED"}},
    {"name": "MAS unblocks a user who has transacted a CFD", "sheet": MAS,
     "inputs": {"HaveYouTransactedCFD": "Yes",
                "MasDegree": "No", "MasCert": "No", "MasWork": "No"},
     "expect": {"CFD (CKA)": "Not blocked"}},
    {"name": "MAS unblocks a user with a listed qualification even if never transacted", "sheet": MAS,
     "inputs": {"HaveYouTransactedCFD": "No",
                "MasDegree": "Yes", "MasCert": "No", "MasWork": "No"},
     "expect": {"CFD (CKA)": "Not blocked"}},
    {"name": "MAS derives CkaTradingKnowledge from the three criteria (cert alone unblocks)",
     "sheet": MAS,
     "inputs": {"HaveYouTransactedCFD": "No",
                "MasDegree": "No", "MasCert": "Yes", "MasWork": "No"},
     "expect": {"CFD (CKA)": "Not blocked"}},

    # ---- MAS CAR (ETF) ----------------------------------------------------
    {"name": "MAS CAR blocks a user who never transacted an ETF and holds none of the three CAR criteria",
     "sheet": MAS,
     "inputs": {"HaveYouTransactedEtf": "No",
                "CarDegree": "No", "CarCert": "No", "CarWork": "No"},
     "expect": {"ETF (CAR)": "BLOCKED"}},
    {"name": "MAS CAR unblocks a user who has transacted an ETF",
     "sheet": MAS,
     "inputs": {"HaveYouTransactedEtf": "Yes",
                "CarDegree": "No", "CarCert": "No", "CarWork": "No"},
     "expect": {"ETF (CAR)": "Not blocked"}},
    {"name": "MAS CAR unblocks a user with a listed qualification even if never transacted an ETF",
     "sheet": MAS,
     "inputs": {"HaveYouTransactedEtf": "No",
                "CarDegree": "Yes", "CarCert": "No", "CarWork": "No"},
     "expect": {"ETF (CAR)": "Not blocked"}},
    {"name": "MAS CAR is independent of CKA (CKA pass does not unblock ETF)",
     "sheet": MAS,
     "inputs": {"HaveYouTransactedCFD": "Yes",
                "MasDegree": "No", "MasCert": "No", "MasWork": "No",
                "HaveYouTransactedEtf": "No",
                "CarDegree": "No", "CarCert": "No", "CarWork": "No"},
     "expect": {"CFD (CKA)": "Not blocked", "ETF (CAR)": "BLOCKED"}},

    # ---- UK overlay -------------------------------------------------------
    {"name": "UK overlay stays blocked without full attestation", "sheet": FCA,
     "inputs": {"UkVerity": 5, "UkHNW": "Yes", "UkSoph": "No"},
     "expect": {"Crypto - UK overlay (country 218)": "BLOCKED"}},
    {"name": "UK overlay clears with 5/5 + both attestations", "sheet": FCA,
     "inputs": {"UkVerity": 5, "UkHNW": "Yes", "UkSoph": "Yes"},
     "expect": {"Crypto - UK overlay (country 218)": "Not blocked"}},
]


def unwrap(value):
    while hasattr(value, "value"):
        value = value.value
    if hasattr(value, "tolist"):
        flat = value.tolist()
        while isinstance(flat, list) and flat:
            flat = flat[0]
        return flat
    return value


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    if only and only not in SHEETS:
        print(f"unknown tab {only!r}; expected one of {SHEETS}")
        return 2

    maps = {s: locate(s) for s in SHEETS}
    model = formulas.ExcelModel().loads(BOOK).finish()
    failures = []
    ran = 0

    for case in CASES:
        sheet = case["sheet"]
        if only and sheet != only:
            continue
        ran += 1
        ref = f"'[{BOOK}]{sheet.upper()}'!"
        m = maps[sheet]

        overrides = {}
        for name, val in case.get("inputs", {}).items():
            if name not in m["inputs"]:
                failures.append(f"[{sheet}] {case['name']}: no input cell for {name!r}")
                continue
            overrides[ref + m["inputs"][name]] = [[val]]
        for cfg_name, val in case.get("quiz", {}).items():
            if cfg_name in m["quiz"]:
                overrides[ref + m["quiz"][cfg_name]] = [[val]]
        if "days" in case and m["days"]:
            overrides[ref + m["days"]] = [[case["days"]]]
        if "trades" in case and m["trades"]:
            overrides[ref + m["trades"]] = [[case["trades"]]]

        sol = model.calculate(inputs=overrides or None)
        got = {title: unwrap(sol[ref + cell]) for title, cell in m["results"].items()}

        print(f"\n[{sheet}] {case['name']}")
        print("  " + "  |  ".join(f"{t}={v}" for t, v in got.items()))

        for product, want in case["expect"].items():
            if product not in got:
                failures.append(f"[{sheet}] {case['name']}: product {product!r} not on this tab")
                continue
            actual = str(got[product]).strip()
            if actual != want:
                failures.append(
                    f"[{sheet}] {case['name']}: {product} expected {want!r}, got {actual!r}")

    print()
    if failures:
        for f in failures:
            print("FAIL", f)
        return 1
    print(f"all {ran} cases passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
