"""Generate the eToro Negative Market (NM) calculator workbook.

Sibling of build_workbook.py (copy suitability). This one models the *product
knockouts* - CFD / Futures / Margin / Crypto / ERS - not the graded copy score.
NM, Suitability and Appropriateness are three separate tests; this file is only NM.

    python build_nm_workbook.py       # writes eToro-negative-market-calculator.xlsx
    python verify_nm_workbook.py      # recalculates and asserts the outcomes

Every rule here is transcribed verbatim from the live ClientRiskProfileConfiguration
documents in config-prod/ (CySEC-24, FCA-15, ASIC-9, ASICGAML-15, FSRA-10, MAS-12),
read from production Cosmos on 2026-08-09/10. Product configuration only - no client
data, no credentials.

Honesty notes baked into the sheet, because they bound how far you can trust it:
  * NM calls CalculateWithBlockResult, so Check.DefaultResult IS live here (unlike
    suitability). Fail-closed vs fail-open therefore differs by regulation.
  * How the engine combines several Rules on one product has NOT been re-traced in C#.
    The model used is "product blocked if any still-active rule is Blocked". Flagged.
  * The CySEC/FCA nested TradingExperience "rescue" (pass one of: quiz >= -3, either
    5-question set >= 3 correct) is the documented intent; its evaluation order is the
    weakest reconstructed part.
  * Auto-release (days from FTD + closed trades) needs trading data the profile store
    does not hold. Modelled as explicit inputs so its effect is visible, not invented.
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "eToro-negative-market-calculator.xlsx"

INK = "1F2A37"
ACCENT = "7A2E2E"          # NM gets a red-brown accent so it is not mistaken for the ST book
HEAD_FILL = PatternFill("solid", fgColor="7A2E2E")
INPUT_FILL = PatternFill("solid", fgColor="FFF6D6")
CALC_FILL = PatternFill("solid", fgColor="F2F4F7")
OK_FILL = PatternFill("solid", fgColor="DCEBE6")
BLOCK_FILL = PatternFill("solid", fgColor="FDE7E4")
GREY_FILL = PatternFill("solid", fgColor="EEF0F2")

H1 = Font(bold=True, size=16, color=INK)
H2 = Font(bold=True, size=12, color=ACCENT)
HEAD = Font(bold=True, size=10, color="FFFFFF")
BOLD = Font(bold=True, size=10, color=INK)
BODY = Font(size=10, color=INK)
SMALL = Font(size=9, color="6B7280")
MONO = Font(name="Menlo", size=9, color=INK)
BIG = Font(bold=True, size=13, color=ACCENT)
ALERT = Font(bold=True, size=9, color="B42318")

THIN = Side(style="thin", color="D5DBE0")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center")
LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)

# ---------------------------------------------------------------------------
# Answer domains and labels. Every enum that appears in an NM check must have a
# label here; the "fires?" formulas compare the picked label, and the Rules sheet
# shows the enum name alongside for traceability.
# ---------------------------------------------------------------------------
RISK = [
    ("Plus5ToMinus3Percent", "5% / -3%"),
    ("Plus10ToMinus6Percent", "10% / -6%"),
    ("Plus20ToMinus12Percent", "20% / -12%"),
    ("Plus40ToMinus24Percent", "40% / -24%"),
    ("Plus80ToMinus48Percent", "80% / -48%"),
]
# Two income/asset catalogues appear across configs; the FCA checks list both, so the
# dropdown is the union. Only the enum name matters to a check.
INCOME = [
    ("UpTo10K", "Up to 10K"),
    ("Between10KAnd50K", "10K - 50K"),
    ("Between50KAnd200K", "50K - 200K"),
    ("Between200KAnd500K", "200K - 500K"),
    ("Between500KAnd1M", "500K - 1M"),
    ("Between1MAnd5M", "1M - 5M"),
    ("LessThan25K", "Less than 25K (alt catalogue)"),
    ("Between10KAnd25K", "10K - 25K (alt)"),
    ("Between25KAnd50K", "25K - 50K (alt)"),
    ("Between200KTo500K", "200K - 500K (alt)"),
]
PURPOSE = [
    ("ShortTermReturns", "Short-term returns"),
    ("AdditionalRevenues", "Additional revenues"),
    ("FuturePlanning", "Future planning"),
    ("SavingsForHome", "Saving for a home"),
    ("Investments", "Investments"),
]
EXPERIENCE = [("NeverTraded", "Never traded"), ("TradedBefore", "Traded before")]
KNOWLEDGE = [
    ("NoFinancialKnowledge", "No financial knowledge"),
    ("TradingCourses", "Trading courses"),
    ("UniversityDegree", "University degree in finance"),
    ("ProfessionalCertificate", "Professional certificate / experience"),
]
INCOME_SOURCE = [
    ("Salary", "Salary"), ("Investments", "Investments"), ("Savings", "Savings"),
    ("BusinessActivities", "Business activities"), ("Inheritance", "Inheritance"),
    ("Pension", "Pension"), ("SocialSecurity", "Social security"),
]
OCCUPATION = [
    ("Employed", "Employed"), ("SelfEmployed", "Self-employed"),
    ("NoOccupation", "No occupation"), ("Retired", "Retired"),
]
YESNO = [("Yes", "Yes"), ("No", "No")]

# ---------------------------------------------------------------------------
# ASIC GAML CFD & Futures knockout questionnaire (source of truth: the "Typeform"
# sheet of "Futures Suitability Test_V04"). One question = one row.
# Each question: (input key, scope, label, [(answer label, is_knockout)]).
#   scope: "both" -> asked for CFDs & Futures, "cfd" -> CFD only, "fut" -> Futures only.
# The first answer is the default and is always a passing one, so a fresh sheet opens
# Not blocked.
# ---------------------------------------------------------------------------
TYPEFORM = [
    ("tf_leverage", "both",
     "Q1 Leverage can increase losses as well as gains",
     [("Yes", False), ("No", True)]),
    ("tf_loseall", "both",
     "Q2 Can you lose the entire amount invested in your leveraged products "
     "(eg Futures or CFDs) portfolio?",
     [("Yes", False), ("No", True)]),
    ("tf_distress", "both",
     "Q3 Would you be subject to emotional distress if your leveraged products "
     "portfolio declines in value by 25% in a short period?",
     [("No", False), ("Yes", True)]),
    ("tf_hardship", "both",
     "Q4 If you were to lose your entire amount invested in leveraged products, "
     "would you be subject to material hardship?",
     [("No", False), ("Yes", True)]),
    ("tf_margincall", "both",
     "Q5 If your leveraged products positions decline in value you may suffer a "
     "margin call. Will you be able to meet a margin call without material stress?",
     [("Yes", False), ("No", True)]),
    ("tf_purpose", "both",
     "Q6 Which best describes your purpose for wanting to trade leveraged products "
     "(eg Futures or CFDs)?",
     [("To access the leverage provided", False),
      ("To diversify my investment portfolio", False),
      ("To speculate on potential market movements", False),
      ("To hedge other exposures", False),
      ("Saving for a home or long term investment priorities", True)]),
    ("tf_ownership", "cfd",
     "Q7 Buying a CFD gives you ownership of the underlying instrument",
     [("No", False), ("Yes", True)]),
    ("tf_cfd_duration", "cfd",
     "Q8 How long do you plan to keep your CFD positions open?",
     [("Up to several days", False), ("Few weeks up to one month", False),
      ("Several months", True), ("More than several months/years", True)]),
    ("tf_fut_margin", "fut",
     "Q9 Initial margin in futures trading refers to:",
     [("A security deposit required to open a position", False),
      ("The total value of the contract", True),
      ("Daily settlement amount", True)]),
    ("tf_fut_timeframe", "fut",
     "Q10 Futures contracts have the following timeframe:",
     [("Few weeks", False), ("Monthly, quarterly, annually", False),
      ("Up to several days", True)]),
    ("tf_fut_monitor", "fut",
     "Q11 Do you have the ability to monitor open positions in accordance with the "
     "position time horizon?",
     [("Yes", False), ("No", True)]),
]


def tf_for(scope_kind):
    """Typeform questions in the order shown for a product.
    scope_kind is "cfd" or "fut"; returns the shared "both" questions first, then
    the product-specific ones."""
    return [q for q in TYPEFORM if q[1] == "both"] + \
           [q for q in TYPEFORM if q[1] == scope_kind]


def labels(pairs):
    return [lab for _e, lab in pairs]


def lab(pairs, enum):
    for e, l in pairs:
        if e == enum:
            return l
    raise KeyError(enum)


# ---------------------------------------------------------------------------
# Knowledge assessment (TradingKnowledgeAssessment) - the same +2/-2 statement
# group suitability uses, read here through the NM cutoff score < -3 => Blocked.
# ---------------------------------------------------------------------------
KA = [
    (142, "NewerLeverage", 2,
     "$1,000 at 20x leverage: a 5% adverse move wipes out my investment", True),
    (144, "NewerMarginCall", 2,
     "If account equity falls below required margin, a margin call liquidates positions", True),
    (143, "NewerCfd", -2,
     "If Google rises on NASDAQ, my Google CFD goes down", False),
    (145, "NewerStopLossTrigger", -2,
     "My positions stay open even when a stop loss is triggered", False),
    (146, "NewerStopLossGapThrough", -2,
     "If the market gaps through my stop loss, it closes at the exact stop level", False),
    (212, "NewerCfdTrs", -2,
     "I can sell my OTC complex products (CFD, TRS) outside eToro", False),
]
KA_DEFAULT_TICKED = {"NewerLeverage", "NewerCfd"}
KA_RETIRED = {"NewerCfdTrs"}   # scored, no longer asked -> constant +2, same as ST book
KA_CUTOFF = -3                 # score >= -3 => NotBlocked on the NM knockout

# ---------------------------------------------------------------------------
# Per-regulation NM composition. Products list only what the live document carries.
# "shape" selects the evaluation modelled below.
# ---------------------------------------------------------------------------
REGS = [
    dict(sheet="CySEC v24", name="CySEC", doc="CySEC-24",
         cfd_default="Blocked", exp_autorelease=(60, 20), exp_shape="nested",
         products=["cfd", "futures", "margin", "expcrypto"]),
    dict(sheet="FCA v15", name="FCA", doc="FCA-15",
         cfd_default="Blocked", exp_autorelease=(30, 5), exp_shape="nested",
         products=["cfd_fca", "futures_fca", "expcrypto", "ers", "ukcrypto"]),
    dict(sheet="ASIC v9", name="ASIC", doc="ASIC-9",
         cfd_default="not set", exp_autorelease=(30, 5), exp_shape="flat",
         products=["cfd_asic"]),
    dict(sheet="ASIC GAML v15", name="ASIC GAML", doc="ASICGAML-15",
         cfd_default="not set", exp_autorelease=(30, 5), exp_shape="flat",
         products=["cfd_gaml", "futures_gaml", "expcrypto_gaml"]),
    dict(sheet="FSRA v10", name="FSRA", doc="FSRA-10",
         cfd_default="not set", exp_autorelease=(30, 5), exp_shape="flat",
         products=["cfd", "crypto_fsra"]),
    dict(sheet="MAS v12", name="MAS", doc="MAS-12",
         cfd_default="Blocked", exp_autorelease=None, exp_shape="mas",
         products=["cfd_mas", "etf_mas"]),
]

wb = Workbook()
wb.remove(wb.active)   # drop the default empty sheet; every tab is created explicitly


def style_header(ws, row, cols):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEAD_FILL
        cell.font = HEAD
        cell.border = BOX
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = 20


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def boxed(ws, row, cols):
    for c in range(1, cols + 1):
        ws.cell(row=row, column=c).border = BOX


# ===========================================================================
# Lists (hidden) - dropdown sources
# ===========================================================================
ls = wb.create_sheet("Lists")
ls["A1"] = "Dropdown sources for data validation."
ls["A1"].font = SMALL
_list_ranges = {}
_col = 1


def add_list(key, values):
    global _col
    letter = get_column_letter(_col)
    ls.cell(row=1, column=_col, value=key).font = BOLD
    for i, v in enumerate(values, start=2):
        ls.cell(row=i, column=_col, value=v).font = BODY
    _list_ranges[key] = f"Lists!${letter}$2:${letter}${1 + len(values)}"
    ls.column_dimensions[letter].width = 26
    _col += 1


add_list("Risk", labels(RISK))
add_list("Income", labels(INCOME))
add_list("Purpose", labels(PURPOSE))
add_list("Experience", labels(EXPERIENCE))
add_list("Knowledge", labels(KNOWLEDGE))
add_list("IncomeSource", labels(INCOME_SOURCE))
add_list("Occupation", labels(OCCUPATION))
add_list("YesNo", labels(YESNO))
add_list("Count5", [0, 1, 2, 3, 4, 5])   # numeric, so ">= 3" compares as numbers not text
for _key, _scope, _q, _answers in TYPEFORM:
    add_list(_key, [a for a, _ko in _answers])
ls.sheet_state = "hidden"


# ===========================================================================
# One calculator tab per regulation
# ===========================================================================
def build_tab(reg):
    ws = wb.create_sheet(reg["sheet"])
    ws["A1"] = f"Negative Market - {reg['name']}"
    ws["A1"].font = H1
    ws["A2"] = (f"Models {reg['doc']}, the live configuration for {reg['name']}. Answer the "
                f"yellow cells; every product knockout below is computed from them. This is "
                f"Negative Market only - not the copy suitability score, not appropriateness.")
    ws["A2"].font = SMALL
    ws.merge_cells("A2:F2")
    widths(ws, {"A": 3, "B": 44, "C": 30, "D": 22, "E": 12, "F": 30})

    state = {"row": 4, "step": 0, "in": {}, "results": []}

    def heading(text):
        state["step"] += 1
        ws.cell(row=state["row"], column=1, value=f"STEP {state['step']}").font = H2
        ws.cell(row=state["row"], column=2, value=text).font = H2
        state["row"] += 1

    def para(text, lines=2, font=SMALL):
        ws.cell(row=state["row"], column=2, value=text).font = font
        ws.cell(row=state["row"], column=2).alignment = WRAP
        ws.merge_cells(start_row=state["row"], start_column=2,
                       end_row=state["row"] + lines - 1, end_column=6)
        state["row"] += lines

    def input_row(key, question, list_key, default_label, note=""):
        r = state["row"]
        ws.cell(row=r, column=2, value=question).font = BODY
        ws.cell(row=r, column=2).alignment = WRAP
        cell = ws.cell(row=r, column=3, value=default_label)
        cell.font = BOLD
        cell.fill = INPUT_FILL
        if note:
            ws.cell(row=r, column=6, value=note).font = SMALL
        boxed(ws, r, 6)
        dv = DataValidation(type="list", formula1=_list_ranges[list_key], allow_blank=False)
        ws.add_data_validation(dv)
        dv.add(cell)
        state["in"][key] = f"C{r}"
        state["row"] += 1
        return f"C{r}"

    def fires(cell, pairs, enums):
        opts = ",".join(f'{cell}="{lab(pairs, e)}"' for e in enums)
        return f"OR({opts})"

    # ---- questions used by this regulation's NM products -------------------
    heading("KYC answers")
    for i, v in enumerate(["", "Question", "Your answer", "", "", "Config question"], start=1):
        ws.cell(row=state["row"], column=i, value=v)
    style_header(ws, state["row"], 6)
    state["row"] += 1

    P = reg["products"]
    needs_appetite = any(p in P for p in
                         ("cfd", "cfd_fca", "cfd_asic", "cfd_gaml", "futures", "futures_gaml",
                          "futures_fca", "margin", "expcrypto", "expcrypto_gaml", "ers", "crypto_fsra"))
    if needs_appetite:
        input_row("RiskAppetite", "Q9 gain / loss appetite", "Risk", lab(RISK, "Plus20ToMinus12Percent"),
                  "RiskAppetite")
    if any(p in P for p in ("cfd", "cfd_fca", "cfd_asic", "cfd_gaml", "futures", "futures_gaml",
                            "futures_fca", "margin", "ers")):
        input_row("AnnualIncome", "Q10 net annual income", "Income", lab(INCOME, "Between50KAnd200K"),
                  "AnnualIncome")
    if any(p in P for p in ("cfd_asic", "cfd_gaml", "futures_gaml", "cfd_fca", "futures_fca")):
        input_row("LiquidAssets", "Q11 liquid assets", "Income", lab(INCOME, "Between50KAnd200K"),
                  "LiquidAssets")
    if "cfd_asic" in P:
        input_row("TradingPurpose", "Q8 purpose of trading", "Purpose", lab(PURPOSE, "AdditionalRevenues"),
                  "TradingPurpose")
    if any(p in P for p in ("cfd_gaml", "futures_gaml", "cfd_fca", "futures_fca")):
        input_row("IncomeSource", "Q15 source of income", "IncomeSource", lab(INCOME_SOURCE, "Salary"),
                  "IncomeSource")
    if any(p in P for p in ("cfd_fca", "futures_fca")):
        input_row("Occupation", "Q occupation", "Occupation", lab(OCCUPATION, "Employed"), "Occupation")
    if any(p in P for p in ("cfd", "cfd_fca", "cfd_asic", "cfd_gaml", "futures_gaml", "futures",
                            "futures_fca", "margin")):
        input_row("Crypto", "Have you traded crypto?", "Experience", lab(EXPERIENCE, "TradedBefore"), "Crypto")
        input_row("LeveragedCfd", "Have you traded leveraged CFDs?", "Experience",
                  lab(EXPERIENCE, "TradedBefore"), "LeveragedCfd")
        input_row("TradingKnowledge", "Q3 financial knowledge", "Knowledge",
                  lab(KNOWLEDGE, "TradingCourses"), "TradingKnowledge")

    # MAS-specific. CkaTradingKnowledge is NOT a free self-declared level: MAS's Customer
    # Knowledge Assessment derives it from the three CKA criteria (academic qualification,
    # professional certificate, work experience). It reads NoFinancialKnowledge exactly when
    # the user holds none of them, so it is a computed row here, not a yellow input.
    if "cfd_mas" in P:
        input_row("HaveYouTransactedCFD", "Have you transacted a CFD before?", "YesNo", "Yes",
                  "HaveYouTransactedCFD")
        cka_row = state["row"]          # reserve row 7 for the derived value
        state["row"] += 1
        d = input_row("MasDegree", "Hold a listed finance academic qualification?", "YesNo", "No",
                      "CkaAcademicQualification (see Rules)")
        c = input_row("MasCert", "Hold a listed professional certificate?", "YesNo", "No",
                      "CkaProfessionalCertificate (see Rules)")
        w = input_row("MasWork", "Have listed finance work experience?", "YesNo", "No",
                      "CkaWorkExperience (see Rules)")
        ws.cell(row=cka_row, column=2,
                value="CkaTradingKnowledge (derived from the three CKA criteria below)").font = BODY
        ws.cell(row=cka_row, column=2).alignment = WRAP
        cell = ws.cell(row=cka_row, column=3,
                       value=f'=IF(OR({d}="Yes",{c}="Yes",{w}="Yes"),'
                             f'"Has relevant knowledge","No financial knowledge")')
        cell.font = BOLD
        cell.fill = CALC_FILL
        ws.cell(row=cka_row, column=6, value="CkaTradingKnowledge (computed)").font = SMALL
        boxed(ws, cka_row, 6)
        state["in"]["CkaTradingKnowledge"] = f"C{cka_row}"

    # MAS CAR (Client Account Review) for ETFs. Same shape as CKA: knowledge is derived
    # from the three listed criteria, not self-declared. Live MAS-12.json has no
    # EtfNegativeMarket block; this is modelled as a copy of CfdNegativeMarket on the
    # CAR questions. Stored MAS profiles already carry an Etf product key.
    if "etf_mas" in P:
        para("ETF - CAR (Client Account Review). Practically a copy of CKA, for listed SIPs (ETFs) "
             "instead of unlisted SIPs (CFDs). CarTradingKnowledge is derived from the three CAR "
             "criteria below. Same listed qualification / certificate / work-experience sets as CKA "
             "(see Rules).", lines=3)
        input_row("HaveYouTransactedEtf", "Have you transacted an ETF before?", "YesNo", "Yes",
                  "HaveYouTransactedEtf")
        car_row = state["row"]
        state["row"] += 1
        cd = input_row("CarDegree", "Hold a listed finance academic qualification (CAR)?", "YesNo", "No",
                       "CarAcademicQualification (see Rules)")
        cc = input_row("CarCert", "Hold a listed professional certificate (CAR)?", "YesNo", "No",
                       "CarProfessionalCertificate (see Rules)")
        cw = input_row("CarWork", "Have listed finance work experience (CAR)?", "YesNo", "No",
                       "CarWorkExperience (see Rules)")
        ws.cell(row=car_row, column=2,
                value="CarTradingKnowledge (derived from the three CAR criteria below)").font = BODY
        ws.cell(row=car_row, column=2).alignment = WRAP
        cell = ws.cell(row=car_row, column=3,
                       value=f'=IF(OR({cd}="Yes",{cc}="Yes",{cw}="Yes"),'
                             f'"Has relevant knowledge","No financial knowledge")')
        cell.font = BOLD
        cell.fill = CALC_FILL
        ws.cell(row=car_row, column=6, value="CarTradingKnowledge (computed)").font = SMALL
        boxed(ws, car_row, 6)
        state["in"]["CarTradingKnowledge"] = f"C{car_row}"

    state["row"] += 1

    # ---- knowledge assessment quiz ---------------------------------------
    needs_quiz = any(p in P for p in
                     ("cfd", "cfd_fca", "cfd_asic", "cfd_gaml", "futures_gaml", "futures",
                      "futures_fca", "margin"))
    ka_total = None
    if needs_quiz:
        heading("Q23 knowledge assessment (feeds the experience rule)")
        para("Same six-statement group as the copy test. Tick Yes for each statement you would "
             "select. Ticking a true statement or leaving a false one alone earns +2; the opposite "
             "costs -2. On Negative Market the cutoff is a pass/fail: score of -3 or higher does "
             "NOT block. (The copy test reads the same score through four risk bands instead.)",
             lines=3)
        for i, v in enumerate(["ID", "Statement", "Selected?", "Weight", "Contribution", "Config name"],
                              start=1):
            ws.cell(row=state["row"], column=i, value=v)
        style_header(ws, state["row"], 6)
        state["row"] += 1
        first = state["row"]
        for aid, name, score, text, is_true in KA:
            ws.cell(row=state["row"], column=1, value=aid).font = SMALL
            label = text + ("  [RETIRED - no longer asked]" if name in KA_RETIRED else "")
            ws.cell(row=state["row"], column=2, value=label).font = BODY
            ws.cell(row=state["row"], column=2).alignment = WRAP
            cell = ws.cell(row=state["row"], column=3, value="Yes" if name in KA_DEFAULT_TICKED else "No")
            cell.font = ALERT if name in KA_RETIRED else BOLD
            cell.fill = INPUT_FILL
            ws.cell(row=state["row"], column=4, value=f"{score:+d}").font = SMALL
            ws.cell(row=state["row"], column=4).alignment = CENTER
            ws.cell(row=state["row"], column=5,
                    value=f'=IF(C{state["row"]}="Yes",{score},{-score})').font = BOLD
            ws.cell(row=state["row"], column=5).alignment = CENTER
            ws.cell(row=state["row"], column=6, value=name).font = MONO
            boxed(ws, state["row"], 6)
            ws.row_dimensions[state["row"]].height = max(16, 12 * (len(label) // 46 + 1))
            dv = DataValidation(type="list", formula1=_list_ranges["YesNo"], allow_blank=False)
            ws.add_data_validation(dv)
            dv.add(cell)
            state["row"] += 1
        last = state["row"] - 1
        ws.cell(row=state["row"], column=2, value="Assessment total score").font = BOLD
        ws.cell(row=state["row"], column=5, value=f"=SUM(E{first}:E{last})").font = BOLD
        ws.cell(row=state["row"], column=5).fill = CALC_FILL
        ws.cell(row=state["row"], column=5).alignment = CENTER
        ws.cell(row=state["row"], column=6,
                value=f'=IF(E{state["row"]}>={KA_CUTOFF},"pass (>= -3)","FAIL (< -3)")').font = SMALL
        boxed(ws, state["row"], 6)
        ka_total = f"E{state['row']}"
        state["row"] += 2

    # ---- experience rescue extras (CySEC/FCA nested only) -----------------
    setA = setB = None
    if reg["exp_shape"] == "nested":
        heading("CFD knowledge questionnaires (alternative rescue)")
        para("On CySEC/FCA the experience rule blocks an inexperienced user UNLESS they pass one "
             "knowledge gate: the quiz above (score >= -3), OR a 5-question CFD questionnaire with "
             "3+ correct, OR a second 5-question questionnaire with 3+ correct. The exact questions "
             "are on the Rules tab. Enter how many of each set the user answered correctly.", lines=3)
        setA = input_row("SetA", "Questionnaire set 1 - number correct (of 5)", "Count5", 0,
                         "MinCount 3 to rescue")
        setB = input_row("SetB", "Questionnaire set 2 - number correct (of 5)", "Count5", 0,
                         "MinCount 3 to rescue")
        state["row"] += 1

    # ---- auto-release inputs ---------------------------------------------
    ar_days = ar_trades = None
    released_cell = None
    if reg["exp_autorelease"]:
        d, t = reg["exp_autorelease"]
        heading("Auto-release (experience rule only)")
        para(f"The experience knockout auto-releases {d} days after first deposit once the user has "
             f"{t} closed trades. This needs trading data the profile store does not hold, so it is "
             f"an explicit input here rather than something the sheet can derive. KnockOut rules "
             f"never auto-release.", lines=2)
        r = state["row"]
        ws.cell(row=r, column=2, value="Days since first-time deposit").font = BODY
        c = ws.cell(row=r, column=3, value=0)
        c.fill = INPUT_FILL
        c.font = BOLD
        c.alignment = CENTER
        boxed(ws, r, 6)
        ar_days = f"C{r}"
        state["row"] += 1
        r = state["row"]
        ws.cell(row=r, column=2, value="Closed trades since FTD").font = BODY
        c = ws.cell(row=r, column=3, value=0)
        c.fill = INPUT_FILL
        c.font = BOLD
        c.alignment = CENTER
        boxed(ws, r, 6)
        ar_trades = f"C{r}"
        state["row"] += 1
        ws.cell(row=state["row"], column=2, value="Experience rule auto-released?").font = BODY
        ws.cell(row=state["row"], column=3,
                value=f'=IF(AND({ar_days}>={d},{ar_trades}>={t}),"YES","no")').font = BOLD
        ws.cell(row=state["row"], column=3).alignment = CENTER
        ws.cell(row=state["row"], column=3).fill = CALC_FILL
        boxed(ws, state["row"], 6)
        released_cell = f"C{state['row']}"
        state["row"] += 2

    # UK overlay inputs
    uk_verity = uk_hnw = uk_soph = None
    if "ukcrypto" in P:
        heading("UK crypto overlay (country 218)")
        para("FCA (UK) only. Applies to a user scored under this regulation AND resident in country "
             "218 (GB). Fail-closed: crypto stays blocked unless the user scores 5/5 on a "
             "crypto-knowledge check AND attests both high-net-worth and sophisticated-investor "
             "status.", lines=3)
        uk_verity = input_row("UkVerity", "Crypto-knowledge answers correct (of 5)", "Count5", 0,
                              "MinTotalScore 5")
        uk_hnw = input_row("UkHNW", "I confirm high-net-worth investor", "YesNo", "No",
                           "IConfirmExposeHighNetWorthInvestor")
        uk_soph = input_row("UkSoph", "I confirm sophisticated investor", "YesNo", "No",
                            "IConfirmExposeSophisticatedInvestor")
        state["row"] += 1

    # ASIC GAML CFD & Futures knockout questionnaire (Typeform) - one question per row
    scope_note = {"both": "CFDs & Futures", "cfd": "CFD only", "fut": "Futures only"}
    if "cfd_gaml" in P or "futures_gaml" in P:
        heading("CFD & Futures knockout questions (Typeform)")
        para("Source of truth: the 'Typeform' sheet of the ASIC GAML 'Futures Suitability Test' "
             "workbook. One question = one row. 'Application' shows which product each question "
             "gates. Any answer marked KNOCK OUT blocks the product; a fresh sheet opens Not "
             "blocked. Retaking the test has a 30-day cooling period.", lines=3)
        for key, scope, q, answers in TYPEFORM:
            input_row(key, q, key, answers[0][0],
                      f"{scope_note[scope]} - KO on a red answer")
        state["row"] += 1

    IN = state["in"]

    # ---- product evaluators ----------------------------------------------
    def any_of(cell, labs):
        return "OR(" + ",".join(f'{cell}="{l}"' for l in labs) + ")"

    def knockout_any(pairs_and_enums):
        parts = [fires(IN[key], pairs, enums) for key, pairs, enums in pairs_and_enums]
        return "OR(" + ",".join(parts) + ")"

    def experience_raw():
        inexp = (f'AND({IN["Crypto"]}="{lab(EXPERIENCE, "NeverTraded")}",'
                 f'{IN["LeveragedCfd"]}="{lab(EXPERIENCE, "NeverTraded")}",'
                 f'{IN["TradingKnowledge"]}="{lab(KNOWLEDGE, "NoFinancialKnowledge")}")')
        if reg["exp_shape"] == "nested":
            rescue = f'OR({ka_total}>={KA_CUTOFF},{setA}>=3,{setB}>=3)'
            return f"AND({inexp},NOT({rescue}))"
        return f"AND({inexp},{ka_total}<{KA_CUTOFF})"

    def experience_effective():
        raw = experience_raw()
        if released_cell:
            return f'AND({raw},{released_cell}="no")'
        return raw

    def render_product(title, subtitle, checks, default_result, product_formula,
                       autorelease_note=None, notes=None):
        """checks: list of (rule_name, description, config_answers, fires_formula, ans_cell)."""
        ws.cell(row=state["row"], column=2, value=title).font = BOLD
        ws.cell(row=state["row"], column=6, value=f"DefaultResult: {default_result}").font = SMALL
        state["row"] += 1
        if subtitle:
            ws.cell(row=state["row"], column=2, value=subtitle).font = SMALL
            ws.cell(row=state["row"], column=2).alignment = WRAP
            ws.merge_cells(start_row=state["row"], start_column=2, end_row=state["row"], end_column=6)
            state["row"] += 1
        for i, v in enumerate(["", "Rule / check", "Blocking answers (config)", "Your answer", "Fires?", ""],
                              start=1):
            ws.cell(row=state["row"], column=i, value=v)
        style_header(ws, state["row"], 6)
        state["row"] += 1
        for rule_name, desc, cfg_ans, formula, ans_cell in checks:
            ws.cell(row=state["row"], column=2, value=desc).font = BODY
            ws.cell(row=state["row"], column=2).alignment = WRAP
            ws.cell(row=state["row"], column=3, value=cfg_ans).font = MONO
            ws.cell(row=state["row"], column=3).alignment = WRAP
            if ans_cell:
                ws.cell(row=state["row"], column=4, value=f"={ans_cell}").font = BODY
            if formula:
                ws.cell(row=state["row"], column=5, value=f'=IF({formula},"YES","no")').font = BOLD
                ws.cell(row=state["row"], column=5).alignment = CENTER
            ws.cell(row=state["row"], column=6, value=rule_name).font = SMALL
            boxed(ws, state["row"], 6)
            ws.row_dimensions[state["row"]].height = max(16, 12 * (len(desc) // 40 + 1))
            state["row"] += 1
        if autorelease_note:
            ws.cell(row=state["row"], column=2, value=autorelease_note).font = SMALL
            ws.cell(row=state["row"], column=2).alignment = WRAP
            ws.merge_cells(start_row=state["row"], start_column=2, end_row=state["row"], end_column=6)
            state["row"] += 1
        rr = state["row"]
        ws.cell(row=rr, column=2, value=f"{title}: result").font = BOLD
        ws.cell(row=rr, column=5, value=f'=IF({product_formula},"BLOCKED","Not blocked")').font = BIG
        ws.cell(row=rr, column=5).alignment = CENTER
        for c in range(2, 7):
            ws.cell(row=rr, column=c).border = BOX
        ws.cell(row=rr, column=5).fill = BLOCK_FILL
        state["results"].append((title, f"E{rr}"))
        state["row"] += 1
        if notes:
            ws.cell(row=state["row"], column=2, value=notes).font = ALERT
            ws.cell(row=state["row"], column=2).alignment = WRAP
            ws.merge_cells(start_row=state["row"], start_column=2, end_row=state["row"] + 1, end_column=6)
            state["row"] += 2
        state["row"] += 1

    heading("Product knockouts")
    para("Each product is an independent formula. A missing product simply is not gated by NM under "
         "this regulation - it is NOT an implicit 'not blocked'. Rules within a product are "
         "independent: passing or auto-releasing one does not clear another. Working model for "
         "combining rules: blocked if any still-active rule is Blocked (see Readme caveat).", lines=3)

    def cfd_std(title, autorelease):
        ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"]),
                           ("AnnualIncome", INCOME, ["UpTo10K"])])
        exp = experience_effective()
        d, t = autorelease
        checks = [
            ("KnockOut", "Appetite 5%/-3%  OR  income Up to 10K",
             "RiskAppetite=Plus5ToMinus3Percent; AnnualIncome=UpTo10K", ko, None),
            ("TradingExperience", "Inexperienced (never crypto AND never CFD AND no knowledge) "
             "and fails every knowledge gate",
             "Crypto=NeverTraded AND LeveragedCfd=NeverTraded AND TradingKnowledge=NoFinancialKnowledge; "
             "rescue if quiz>=-3 OR set1>=3 OR set2>=3", experience_raw(), None),
        ]
        render_product(
            title,
            "KnockOut has no auto-release. Experience auto-releases below.",
            checks, reg["cfd_default"],
            product_formula=f"OR({ko},{exp})",
            autorelease_note=(f"Experience auto-release: {d} days from FTD + {t} closed trades. "
                              "Effective experience block = raw block AND not auto-released."),
            notes=("Nested experience + IsAlternative order is the least-verified part of this "
                   "sheet. Confirm against CheckCalculator before treating a pass as authoritative."
                   if reg["exp_shape"] == "nested" else None))

    def cfd_flat(title):
        ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"]),
                           ("AnnualIncome", INCOME, ["UpTo10K"])])
        exp = experience_effective()
        checks = [
            ("KnockOut", "Appetite 5%/-3%  OR  income Up to 10K",
             "RiskAppetite=Plus5ToMinus3Percent; AnnualIncome=UpTo10K", ko, None),
            ("TradingExperience", "Never crypto AND never CFD AND no knowledge AND quiz < -3",
             "Crypto=NeverTraded AND LeveragedCfd=NeverTraded AND TradingKnowledge=NoFinancialKnowledge "
             "AND assessment < -3", experience_raw(), None),
        ]
        render_product(title, "Flat experience rule (no CFD questionnaires).", checks,
                       reg["cfd_default"], f"OR({ko},{exp})",
                       autorelease_note="Experience auto-release: 30 days from FTD + 5 closed trades.")

    for p in P:
        if p == "cfd":
            cfd_flat("CFD") if reg["exp_shape"] == "flat" else cfd_std("CFD", reg["exp_autorelease"])
        elif p == "futures":
            cfd_std("Futures", reg["exp_autorelease"])
        elif p == "margin":
            cfd_std("Margin (SMT)", reg["exp_autorelease"])
        elif p == "cfd_fca":
            ko1 = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"]),
                                ("AnnualIncome", INCOME, ["UpTo10K"])])
            inc_low = ["LessThan25K", "Between10KAnd25K", "Between25KAnd50K", "UpTo10K", "Between10KAnd50K"]
            assets_wide = ["LessThan25K", "Between10KAnd25K", "Between25KAnd50K", "UpTo10K",
                           "Between10KAnd50K", "Between50KAnd200K", "Between200KTo500K"]
            prio2 = (f'AND({fires(IN["IncomeSource"], INCOME_SOURCE, ["Pension", "Salary"])},'
                     f'{fires(IN["AnnualIncome"], INCOME, inc_low)},'
                     f'{fires(IN["LiquidAssets"], INCOME, assets_wide)},'
                     f'{fires(IN["Occupation"], OCCUPATION, ["NoOccupation", "Retired"])})')
            prio3 = (f'AND({fires(IN["IncomeSource"], INCOME_SOURCE, ["Pension"])},'
                     f'{fires(IN["AnnualIncome"], INCOME, inc_low)},'
                     f'{fires(IN["LiquidAssets"], INCOME, assets_wide)})')
            exp = experience_effective()
            checks = [
                ("KnockOut c1", "Appetite 5%/-3%  OR  income Up to 10K",
                 "RiskAppetite=Plus5ToMinus3Percent; AnnualIncome=UpTo10K", ko1, None),
                ("KnockOut c2", "ALL: source in {Pension,Salary}; income <=50K band; assets <=500K band; "
                 "occupation in {NoOccupation,Retired}",
                 "IncomeSource All {Pension,Salary}; AnnualIncome; LiquidAssets; Occupation", prio2, None),
                ("KnockOut c3", "ALL: source = Pension; income <=50K band; assets <=500K band",
                 "IncomeSource=Pension; AnnualIncome; LiquidAssets", prio3, None),
                ("TradingExperience", "Inexperienced and fails every knowledge gate",
                 "as CFD nested; rescue if quiz>=-3 OR set1>=3 OR set2>=3", experience_raw(), None),
            ]
            render_product("CFD", "FCA adds two low-means checks the other regulations do not have.",
                           checks, reg["cfd_default"], f"OR({ko1},{prio2},{prio3},{exp})",
                           autorelease_note="Experience auto-release: 30 days from FTD + 5 closed trades.",
                           notes="Check c2 lists IncomeSource with Condition=All over {Pension,Salary}. "
                           "If income source is single-select this check can never fire. Trace before use.")
        elif p == "futures_fca":
            ws.cell(row=state["row"], column=2,
                    value="Futures: identical structure to CFD above (same three KnockOut checks + "
                          "experience). Same result for the same answers.").font = SMALL
            ws.cell(row=state["row"], column=2).alignment = WRAP
            ws.merge_cells(start_row=state["row"], start_column=2, end_row=state["row"], end_column=6)
            state["row"] += 2
        elif p == "cfd_asic":
            ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"]),
                               ("TradingPurpose", PURPOSE, ["SavingsForHome"]),
                               ("AnnualIncome", INCOME, ["UpTo10K", "Between10KAnd50K"]),
                               ("LiquidAssets", INCOME, ["UpTo10K"])])
            checks = [
                ("KnockOut", "Appetite 5%/-3% OR purpose Saving-for-home OR income <=50K OR assets Up to 10K",
                 "RiskAppetite; TradingPurpose=SavingsForHome; AnnualIncome; LiquidAssets=UpTo10K", ko, None),
                ("TradingExperience", "Never crypto AND never CFD AND no knowledge AND quiz < -3",
                 "flat experience", experience_raw(), None),
            ]
            render_product("CFD", "ASIC-9.json: purpose leg (saving for a home). No pension leg. "
                           "Only the single lowest appetite band.",
                           checks, reg["cfd_default"], f"OR({ko},{experience_effective()})",
                           autorelease_note="Experience auto-release: 30 days from FTD + 5 closed trades.")
        elif p == "cfd_gaml":
            # Spreadsheet "Leveraged Products NMF" matches deployed ASICGAML-15 KnockOut +
            # TradingExperience. The Typeform sheet is the CFD knockout questionnaire (one row each).
            ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent", "Plus10ToMinus6Percent"]),
                               ("AnnualIncome", INCOME, ["UpTo10K", "Between10KAnd50K"]),
                               ("LiquidAssets", INCOME, ["UpTo10K"]),
                               ("IncomeSource", INCOME_SOURCE, ["Pension"])])
            checks = [
                ("Test B - KnockOut", "Appetite 5%/-5% or 10%/-10% OR income <=50K OR assets 0-10K OR "
                 "source Pension (any one)",
                 "RiskAppetite {two lowest}; AnnualIncome {0-10K,10-50K}; LiquidAssets 0-10K; "
                 "IncomeSource=Pension", ko, None),
                ("Test A - TradingExperience", "ALL of: never crypto AND never leveraged AND no knowledge "
                 "AND knowledge assessment Failed (< -3)",
                 "Crypto=Never AND LeveragedCfd=Never AND TradingKnowledge=None AND assessment < -3",
                 experience_raw(), None),
            ]
            tf_parts = []
            for key, scope, q, answers in tf_for("cfd"):
                ko_labs = [a for a, ko in answers if ko]
                f = any_of(IN[key], ko_labs)
                tf_parts.append(f)
                checks.append(("Typeform", q, "KO: " + "; ".join(ko_labs), f, IN[key]))
            tf_block = "OR(" + ",".join(tf_parts) + ")"
            render_product("CFD (leveraged NMF)",
                           "Per the ASIC GAML Futures Suitability Test workbook + ASICGAML-15.json. "
                           "Test A/B is the profile NMF; the Typeform rows are the CFD knockout "
                           "questionnaire (one question per row). 7-day cooling on knockout retake.",
                           checks, reg["cfd_default"],
                           f"OR({ko},{experience_effective()},{tf_block})",
                           autorelease_note="Experience auto-release: 30 days from FTD + 5 closed trades. "
                           "KnockOut and Typeform answers do not auto-release.",
                           notes="Test A/B match the spreadsheet AND ASICGAML-15.json. The Typeform "
                           "questions are the workbook's CFD knockout set; deployed config expresses "
                           "these as a fail-closed CfdRiskAssessment vector.")
        elif p == "futures_gaml":
            stage1 = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent", "Plus10ToMinus6Percent"]),
                                   ("AnnualIncome", INCOME, ["UpTo10K", "Between10KAnd50K"]),
                                   ("LiquidAssets", INCOME, ["UpTo10K"]),
                                   ("IncomeSource", INCOME_SOURCE, ["Pension"])])
            stage1_block = f"OR({stage1},{experience_effective()})"
            s2_parts = []
            checks = [("Stage 1 - onboarding", "Leveraged NMF (Test A + Test B, same inputs and result "
                       "as the CFD block above)", "see CFD (leveraged NMF)", stage1_block, None)]
            for key, scope, q, answers in tf_for("fut"):
                ko_labs = [a for a, ko in answers if ko]
                f = any_of(IN[key], ko_labs)
                s2_parts.append(f)
                checks.append(("Stage 2 - Typeform", q, "KO: " + "; ".join(ko_labs), f, IN[key]))
            stage2_block = "OR(" + ",".join(s2_parts) + ")"
            render_product("Futures", "Two gates: Stage 1 at onboarding (the leveraged NMF) and Stage 2 "
                           "on intent to trade (the Typeform questionnaire, one question per row). "
                           "Blocked if either gate blocks.",
                           checks, "Blocked (Stage 2 default)", f"OR({stage1_block},{stage2_block})",
                           autorelease_note="Stage 1 experience auto-releases at 30 days + 5 trades; "
                           "Stage 2 retake has a 30-day cooling period.",
                           notes="Futures NM is not in ASICGAML-15.json - modelled from the GAML "
                           "Futures Suitability Test workbook, so treat it as spec, not deployed behaviour.")
        elif p == "cfd_mas":
            ko = (f'AND({IN["HaveYouTransactedCFD"]}="No",'
                  f'{IN["CkaTradingKnowledge"]}="{lab(KNOWLEDGE, "NoFinancialKnowledge")}")')
            unblock = (f'OR({IN["HaveYouTransactedCFD"]}="Yes",{IN["MasDegree"]}="Yes",'
                       f'{IN["MasCert"]}="Yes",{IN["MasWork"]}="Yes")')
            checks = [
                ("KnockOut", "Never transacted a CFD AND CKA knowledge = none (i.e. holds none of the "
                 "three CKA criteria)",
                 "HaveYouTransactedCFD=No AND CkaTradingKnowledge=NoFinancialKnowledge", ko,
                 IN["CkaTradingKnowledge"]),
                ("TradingExperience (unblock)", "Transacted a CFD OR holds listed degree / certificate / "
                 "work experience", "HaveYouTransactedCFD=Yes OR CkaAcademicQualification OR "
                 "CkaProfessionalCertificate OR CkaWorkExperience", unblock, None),
            ]
            render_product("CFD (CKA)", "MAS is CKA-shaped: no appetite knockout, no quiz, no auto-release. "
                           "Default Blocked; you are Not blocked only if the unblock rule passes. "
                           "364-day reassessment TTL.", checks, reg["cfd_default"],
                           f"NOT({unblock})",
                           notes="MAS runs no copy-suitability test at all (no Suitability section from v3). "
                           "CKA gates unlisted SIPs (CFDs). CAR below gates listed SIPs (ETFs).")
        elif p == "etf_mas":
            ko = (f'AND({IN["HaveYouTransactedEtf"]}="No",'
                  f'{IN["CarTradingKnowledge"]}="{lab(KNOWLEDGE, "NoFinancialKnowledge")}")')
            unblock = (f'OR({IN["HaveYouTransactedEtf"]}="Yes",{IN["CarDegree"]}="Yes",'
                       f'{IN["CarCert"]}="Yes",{IN["CarWork"]}="Yes")')
            checks = [
                ("KnockOut", "Never transacted an ETF AND CAR knowledge = none (i.e. holds none of the "
                 "three CAR criteria)",
                 "HaveYouTransactedEtf=No AND CarTradingKnowledge=NoFinancialKnowledge", ko,
                 IN["CarTradingKnowledge"]),
                ("TradingExperience (unblock)", "Transacted an ETF OR holds listed degree / certificate / "
                 "work experience", "HaveYouTransactedEtf=Yes OR CarAcademicQualification OR "
                 "CarProfessionalCertificate OR CarWorkExperience", unblock, None),
            ]
            render_product("ETF (CAR)", "Copy of the CKA formula, swapping CFD questions for CAR/ETF "
                           "questions. Same default Blocked, same 364-day reassessment TTL, no "
                           "auto-release.", checks, "Blocked",
                           f"NOT({unblock})",
                           notes="EtfNegativeMarket is not on MAS-12.json. Stored MAS profiles carry "
                           "an Etf product key; this tab models CAR as spec mirroring CKA. Confirm "
                           "against the live document before quoting. Product copy mentions "
                           "'>= 6 ETF trades in 3 years'; the KYC question is binary "
                           "HaveYouTransactedEtf, matching HaveYouTransactedCFD.")
        elif p == "expcrypto":
            ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"])])
            checks = [("KnockOut", "Appetite 5%/-3%", "RiskAppetite=Plus5ToMinus3Percent", ko, None)]
            dr = "Blocked (check)" if reg["name"] == "FCA" else "NotBlocked (check)"
            render_product("Experimental crypto", "Lowest-appetite crypto overlay.", checks, dr, ko)
        elif p == "expcrypto_gaml":
            ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent", "Plus10ToMinus6Percent"])])
            checks = [("KnockOut", "Appetite 5%/-3% or 10%/-6%",
                       "RiskAppetite in {Plus5ToMinus3Percent,Plus10ToMinus6Percent}", ko, None)]
            render_product("Experimental crypto", "GAML widens the appetite band here too.", checks,
                           "NotBlocked (check)", ko)
        elif p == "crypto_fsra":
            ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"])])
            checks = [("KnockOut", "Appetite 5%/-3%", "RiskAppetite=Plus5ToMinus3Percent", ko, None)]
            render_product("Crypto (direct trade)", "FSRA is the only snapshot with a top-level crypto NM. "
                           "OnlyDirectTradeRestriction.", checks, "not set", ko)
        elif p == "ers":
            ko = knockout_any([("RiskAppetite", RISK, ["Plus5ToMinus3Percent"]),
                               ("AnnualIncome", INCOME, ["UpTo10K"])])
            checks = [("KnockOut", "Appetite 5%/-3% OR income Up to 10K",
                       "RiskAppetite=Plus5ToMinus3Percent; AnnualIncome=UpTo10K", ko, None)]
            render_product("ERS (elevated-risk securities)", "No experience rule, no auto-release.", checks,
                           "NotBlocked (check)", ko)
        elif p == "ukcrypto":
            unblock = f'AND({uk_verity}>=5,{uk_hnw}="Yes",{uk_soph}="Yes")'
            checks = [
                ("CryptoKnowledgeAssessment", "Crypto-knowledge answers correct >= 5",
                 "MinTotalScore 5", f"{uk_verity}>=5", uk_verity),
                ("ClassificationQuestionnaire", "HNW = Yes AND Sophisticated = Yes",
                 "IConfirmExposeHighNetWorthInvestor=Yes; IConfirmExposeSophisticatedInvestor=Yes",
                 f'AND({uk_hnw}="Yes",{uk_soph}="Yes")', None),
            ]
            render_product("Crypto - UK overlay (country 218)", "FCA (UK) only. Fail-closed; both rules "
                           "must pass to unblock. Binds for a country-218 (GB) user under FCA.",
                           checks, "Blocked", f"NOT({unblock})",
                           notes="Only shown on the FCA tab - the overlay is UK-specific (country 218).")

    # ---- summary strip ----------------------------------------------------
    heading("Summary - Negative Market status per product")
    for i, v in enumerate(["", "Product", "Status", "", "", ""], start=1):
        ws.cell(row=state["row"], column=i, value=v)
    style_header(ws, state["row"], 6)
    state["row"] += 1
    for title, cell in state["results"]:
        ws.cell(row=state["row"], column=2, value=title).font = BODY
        ws.cell(row=state["row"], column=3, value=f"={cell}").font = BOLD
        ws.cell(row=state["row"], column=3).alignment = CENTER
        ws.cell(row=state["row"], column=3).fill = GREY_FILL
        boxed(ws, state["row"], 6)
        state["row"] += 1
    state["row"] += 1
    para("This tab is Negative Market only. Suitability (copy risk score) and the Appropriateness "
         "status are separate tests with their own outcomes - use their own tools. A user can be "
         "NM-blocked on CFDs and perfectly fine to copy, or vice versa.", lines=2, font=SMALL)

    ws.freeze_panes = "A4"


for _reg in REGS:
    build_tab(_reg)


# ===========================================================================
# Rules reference - the long enum lists that are summarised on the tabs
# ===========================================================================
rl = wb.create_sheet("Rules")
rl["A1"] = "Negative Market - rule reference"
rl["A1"].font = H1
rl["A2"] = ("The exact answer lists behind the summarised checks on the calculator tabs. Verbatim "
            "from config-prod/. Enum names as the engine stores them.")
rl["A2"].font = SMALL
rl.merge_cells("A2:D2")
widths(rl, {"A": 34, "B": 80, "C": 20, "D": 20})

r = 4


def rule_block(title, lines):
    global r
    rl.cell(row=r, column=1, value=title).font = H2
    r += 1
    for ln in lines:
        rl.cell(row=r, column=1, value=ln).font = BODY
        rl.cell(row=r, column=1).alignment = WRAP
        rl.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
        r += 1
    r += 1


rule_block("Knowledge assessment statements (TradingKnowledgeAssessment)",
           [f"{aid}  {name}  ({'+' if s > 0 else ''}{s})  - {txt}"
            for aid, name, s, txt, _t in KA]
           + ["Cutoff on NM: total score >= -3 => NotBlocked (copy test uses four bands instead)."])

rule_block("CySEC/FCA CFD questionnaire set 1 (LessThan 3 correct => still blocked)",
           ["QuestionnaireCfdAssessmentStopLossOrderCanceled",
            "QuestionnaireCfdAssessmentStopLossOrderGuarantee",
            "QuestionnaireCfdAssessmentFailsMarginCall",
            "QuestionnaireCfdAssessmentLeverageDerivative",
            "QuestionnaireCfdAssessmentLeverageRisk",
            "Correct answers differ slightly between CySEC and FCA (see config)."])

rule_block("CySEC/FCA CFD questionnaire set 2 (LessThan 3 correct => still blocked)",
           ["CfdAssessmentSpread", "CfdAssessmentMainRiskLeveragedCfd",
            "CfdAssessmentFactorsPlacementStopLossOrder",
            "CfdAssessmentPurposeStopLossLeveragedDerivative",
            "CfdAssessmentMarginCallProfitableTrade"])

rule_block("ASIC GAML CFD & Futures Typeform knockout set (source: Futures Suitability Test workbook)",
           ["Application scope: 'CFDs & Futures' Qs gate both products; 'CFD only' Qs gate CFD; "
            "'Futures only' Qs gate Futures.",
            "Q1 Leverage increases losses/gains: No = KO. Q2 Can lose entire amount: No = KO.",
            "Q3 Emotional distress at -25%: Yes = KO. Q4 Material hardship if lose all: Yes = KO.",
            "Q5 Meet a margin call without material stress: No = KO.",
            "Q6 Purpose: KO on 'Saving for a home or long term investment priorities'; "
            "leverage/diversify/speculate/hedge pass.",
            "Q7 (CFD only) Buying a CFD gives ownership of the underlying: Yes = KO.",
            "Q8 (CFD only) How long to keep CFD positions open: KO on 'several months' or "
            "'more than several months/years'; up to a month passes.",
            "Q9 (Futures only) Initial margin = : KO on 'total value of the contract' or "
            "'daily settlement amount'; 'security deposit to open a position' passes.",
            "Q10 (Futures only) Futures contract timeframe: KO on 'up to several days'; "
            "few weeks / monthly-quarterly-annually pass.",
            "Q11 (Futures only) Ability to monitor open positions: No = KO.",
            "Deployed ASICGAML-15.json expresses this as a fail-closed CfdRiskAssessment vector."])

rule_block("MAS v12 CkaAcademicQualification (any one unblocks)",
           ["Accountancy, ActuarialScience, BusinessAdministration, BusinessManagementStudies, "
            "CapitalMarkets, Commerce, ComputationalFinance, Economics, Finance, "
            "FinancialEngineering, FinancialPlanning, Insurance"])
rule_block("MAS v12 CkaProfessionalCertificate (any one unblocks)",
           ["ACCA, AFP, AWP, CFP, CTE, FRM, CAIA, CFA, CHFC, CPA, CISI"])
rule_block("MAS v12 CkaWorkExperience (any one unblocks)",
           ["Accountancy, ActuarialScience, FinancialRiskManagement, "
            "DevelopmentOfInvestmentProducts, StructuringOfInvestmentProducts, "
            "ManagementOfInvestmentProducts, SaleOfInvestmentProducts, "
            "TradingOfInvestmentProducts, ResearchAndAnalysisOfInvestmentProducts, "
            "ProvisionOfTrainingInInvestmentProducts, Treasury, "
            "ProvisionOfLegalAdviceOrPossessionOfLegalExpertise"])
rule_block("MAS v12 CAR (ETF) - same listed sets as CKA",
           ["CarAcademicQualification / CarProfessionalCertificate / CarWorkExperience reuse the "
            "same listed answer enums as the three CKA questions above.",
            "KnockOut: HaveYouTransactedEtf=No AND CarTradingKnowledge=NoFinancialKnowledge.",
            "Unblock: HaveYouTransactedEtf=Yes OR any listed CAR criterion.",
            "CarTradingKnowledge is derived (any of the three criteria => Has relevant knowledge).",
            "Not on MAS-12.json; modelled as a copy of CfdNegativeMarket. CarTrainingCourses and "
            "CarDeclinedByOtherFIs exist as KYC questions but are not in the CKA formula either, "
            "so they are omitted here too."])

rule_block("ASIC GAML Futures - two-stage NM (source: Futures Suitability Test workbook)",
           ["Stage 1 (onboarding): the leveraged NMF - Test A (experience) + Test B (profile "
            "knockout), identical inputs/result to the CFD leveraged NMF block.",
            "Stage 2 (intent to trade): the Typeform questionnaire above, scope = 'CFDs & Futures' "
            "+ 'Futures only'. One question per row; any KO answer blocks.",
            "Blocked if either stage blocks. Stage 2 retake has a 30-day cooling period."])

rule_block("UK crypto overlay (country 218) - FCA (UK) only",
           ["CryptoTradingKnowledgeAssessment: +1 per correctly judged Yes/No, MinTotalScore 5.",
            "ClassificationQuestionnaire: IConfirmExposeHighNetWorthInvestor=Yes AND "
            "IConfirmExposeSophisticatedInvestor=Yes.",
            "DefaultResult Blocked, OnlyDirectTradeRestriction, 1-day cooling-off."])

rl.freeze_panes = "A4"


# ===========================================================================
# Readme
# ===========================================================================
rm = wb.create_sheet("Readme", 0)
rm["A1"] = "eToro Negative Market calculator"
rm["A1"].font = Font(bold=True, size=20, color=INK)
widths(rm, {"A": 3, "B": 28, "C": 100})
r = 3


def note(label, text, label_font=BOLD):
    global r
    rm.cell(row=r, column=2, value=label).font = label_font
    cell = rm.cell(row=r, column=3, value=text)
    cell.font = BODY
    cell.alignment = WRAP
    rm.row_dimensions[r].height = max(16, 13 * (len(text) // 98 + 1))
    r += 1


note("What this is",
     "A working model of the live Negative Market (NM) product knockouts at eToro - the tests that "
     "hard-block CFD / Futures / Margin / Crypto / ERS trading. Rules are transcribed verbatim from "
     "the production ClientRiskProfileConfiguration documents in config-prod/. This is one of three "
     "separate tests; the copy-suitability score is eToro-suitability-test-calculator.xlsx, and "
     "appropriateness status is a third test not modelled here.")
r += 1
note("Three separate tests", "Negative Market blocks products. Suitability caps a copy risk score. "
     "Appropriateness warns. They share KYC answers and the knowledge quiz but nothing else - a user "
     "can pass one and fail another. Do not read an NM block as a copy block or vice versa.", ALERT)
r += 1
rm.cell(row=r, column=2, value="Tabs").font = H2
r += 1
note("One tab per regulation", "CySEC v24, FCA v15, ASIC v9, ASIC GAML v15, FSRA v10, MAS v12. Answer "
     "the yellow cells; each product's status is computed below and summarised at the foot of the tab. "
     "Only the products and questions that regulation's document actually carries are shown.")
note("Rules", "The long enum lists (CFD questionnaires, ASIC GAML Typeform set, MAS CKA "
     "qualifications, UK overlay [FCA only]) behind the summarised checks.")
r += 1
rm.cell(row=r, column=2, value="How NM differs from the copy test").font = H2
r += 1
for line in [
    "Per product, not one score. Each product key is its own formula returning Blocked / NotBlocked.",
    "OR of rules, not MIN of factors. Any one active rule blocking blocks the product.",
    "Knowledge quiz cutoff is pass/fail at -3, not four risk bands.",
    "Check.DefaultResult is LIVE here (NM calls CalculateWithBlockResult). It is dead on the copy path.",
    "Auto-release: the experience rule clears after N days from FTD + M closed trades.",
    "Missing product key means NOT gated by NM - it does not mean 'not blocked'.",
]:
    rm.cell(row=r, column=3, value=line).font = MONO
    r += 1
r += 1
rm.cell(row=r, column=2, value="CFD knockout is not shared").font = H2
r += 1
for line in [
    "CySEC / FSRA : appetite 5%/-3% OR income Up-to-10K.",
    "FCA          : those two, plus two pensioner / low-means All-checks.",
    "ASIC         : appetite OR purpose Saving-for-home OR income <=50K OR assets Up-to-10K "
    "(ASIC-9.json).",
    "ASIC GAML    : appetite two lowest bands OR income <=50K OR assets 0-10K OR source Pension "
    "(spreadsheet + ASICGAML-15.json), PLUS the Typeform CFD/Futures knockout questionnaire (one "
    "question per row). Futures adds a two-stage NM (Stage 1 leveraged NMF + Stage 2 Typeform).",
    "MAS v12      : CFD (CKA) = never transacted CFD AND no CKA knowledge; unblocked by CFD trades "
    "or a listed qualification. ETF (CAR) is the same formula on HaveYouTransactedEtf + the three "
    "CAR criteria. No appetite knockout. No suitability test at all.",
]:
    rm.cell(row=r, column=3, value=line).font = MONO
    r += 1
r += 1
rm.cell(row=r, column=2, value="Read before relying on this").font = H2
r += 1
for label, text in [
    ("Rule combination unverified", "How the engine combines several Rules on one product has not been "
     "re-traced in C#. The model here is 'blocked if any still-active rule is Blocked'. Confirm against "
     "CalculateWithBlockResult before quoting a computed verdict externally."),
    ("Nested experience is the weak point", "The CySEC/FCA TradingExperience nest with IsAlternative is "
     "modelled as 'inexperienced AND passes no knowledge gate'. The evaluation order is reconstructed, "
     "not read from code."),
    ("Auto-release needs trading data", "Days-from-FTD and closed-trade count are not in the profile "
     "store. They are inputs here so their effect is visible; a config-only replay cannot derive them."),
    ("FCA income-source check may be dead", "FCA CFD KnockOut check 2 lists IncomeSource with Condition=All "
     "over {Pension,Salary}. If that question is single-select, the check can never fire."),
    ("Config coverage", "config-prod/ holds 8 of ~104 live documents. FSA (Seychelles), US and older "
     "versions are not here. A user on a version not present gets no tab."),
    ("Snapshot", "Read from production Cosmos 2026-08-09 (MAS 08-10). No client data was queried."),
]:
    note(label, text, ALERT)
r += 1
note("Source", "rev-eng/suitability-test/ in etoro-assets. Formulas in nm-formulas.md. Regenerate this "
     "file with build_nm_workbook.py and check it with verify_nm_workbook.py.")

for ws in wb.worksheets:
    ws.sheet_view.showGridLines = False

TAB_ORDER = ["Readme"] + [x["sheet"] for x in REGS] + ["Rules", "Lists"]
wb._sheets.sort(key=lambda ws: TAB_ORDER.index(ws.title))
wb.active = 0
wb.save(OUT)
print(f"wrote {OUT}")
