import json
import re
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request, send_from_directory


BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
SOURCES = {
    "json": ROOT_DIR / "PROFESSIONAL-CLOUD-DATABASE-ENGINEER questions.json",
    "markdown": ROOT_DIR / "google-professional-cloud-database-engineer.md",
    "ai": BASE_DIR / "data" / "ai-questions.json",
}
ASSETS = {"app.js", "style.css"}

app = Flask(__name__, template_folder=str(BASE_DIR / "templates"))


def load_json_questions(source="json"):
    with SOURCES[source].open(encoding="utf-8") as source_file:
        questions = json.load(source_file)
    if not isinstance(questions, list):
        raise ValueError("The JSON source must contain a list of questions.")
    return questions


def load_markdown_questions():
    content = SOURCES["markdown"].read_text(encoding="utf-8")
    sections = re.split(r"(?m)^##\s+", content)
    questions = []

    for section in sections[1:]:
        heading, _, body = section.partition("\n")
        number_match = re.search(r"question\s+#?(\d+)", heading, re.IGNORECASE)
        topic_match = re.search(r"_(\d+)\s+question", heading, re.IGNORECASE)
        option_matches = list(
            re.finditer(
                r"(?m)^\*\*([A-H]):\*\*\s*(.*?)(?=\n\s*\*\*[A-H]:\*\*|\n\s*\*\*Answer:|\Z)",
                body,
                re.DOTALL,
            )
        )
        answer_match = re.search(r"(?m)^\*\*Answer:\s*([A-H]+)\*\*", body)
        if not number_match or not option_matches:
            continue

        stem = body[: option_matches[0].start()].strip()
        options = [
            f"{match.group(1)}. {match.group(2).strip()}"
            for match in option_matches
        ]
        number = number_match.group(1)
        topic = topic_match.group(1) if topic_match else "1"
        answer = answer_match.group(1).upper() if answer_match else ""
        questions.append(
            {
                "question_no": f"Exam Professional Cloud Database Engineer topic {topic} question {number}",
                "question": f"{stem} {' '.join(options)}",
                "community_answer": answer,
                "discussion": [],
            }
        )

    return questions


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/assets/<path:filename>")
def assets(filename):
    if filename not in ASSETS:
        abort(404)
    return send_from_directory(BASE_DIR, filename)


@app.get("/api/questions")
def questions():
    source = request.args.get("source", "json")
    if source not in SOURCES:
        return jsonify({"error": "Unknown question source."}), 400
    try:
        items = load_markdown_questions() if source == "markdown" else load_json_questions(source)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        return jsonify({"error": str(error)}), 500
    return jsonify(items)


if __name__ == "__main__":
    app.run(debug=False)