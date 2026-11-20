import json
import re
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
SOURCE_PATH = BASE_DIR.parent / "PROFESSIONAL-CLOUD-DATABASE-ENGINEER questions.json"
OUTPUT_PATH = BASE_DIR / "data" / "ai-questions.json"
LETTERS = "ABCDEFGH"


def split_question(text):
    text = re.sub(r"\s*Show Suggested Answer.*$", "", text, flags=re.IGNORECASE).strip()
    best = None

    for match in re.finditer(r"(?:^|\s)A\.(?=\s|\d)", text):
        first_start = match.start() + (0 if text[match.start()] == "A" else 1)
        marks = [("A", first_start)]
        search_from = match.end()

        for letter in LETTERS[1:]:
            next_option = re.search(rf"\s{letter}\.(?=\s|\d)", text[search_from:])
            if not next_option:
                break
            option_start = search_from + next_option.start() + 1
            marks.append((letter, option_start))
            search_from += next_option.end()

        if len(marks) >= 2 and (best is None or len(marks) >= len(best)):
            best = marks

    if not best:
        raise ValueError("Could not find at least two labeled choices in a question.")

    question = text[:best[0][1]].strip()
    choices = {
        letter: text[start + 2 : best[index + 1][1] if index + 1 < len(best) else None].strip()
        for index, (letter, start) in enumerate(best)
    }
    return question, choices


def build_export():
    with SOURCE_PATH.open(encoding="utf-8") as source_file:
        questions = json.load(source_file)
    if not isinstance(questions, list):
        raise ValueError("The source JSON must contain a list of questions.")

    exported = []
    for item in questions:
        question, choices = split_question(item.get("question", ""))
        exported.append(
            {
                "question_no": item.get("question_no", ""),
                "question": question,
                "choices": choices,
            }
        )
    return exported


if __name__ == "__main__":
    data = build_export()
    OUTPUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(data)} questions to {OUTPUT_PATH}")