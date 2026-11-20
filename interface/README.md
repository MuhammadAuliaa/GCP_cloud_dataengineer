# Exam practice app

Run the app from this directory:

```sh
python3 -m pip install -r requirements.txt
python3 app.py
```

Open http://127.0.0.1:5000. Choose the community JSON, Markdown, or AI-ready JSON question bank from the setup screen. Progress is stored separately for each source in the browser.

To regenerate the AI-ready export after updating the source JSON, run:

```sh
python3 export_ai_questions.py
```

The export is `data/ai-questions.json`. Each item contains `question_no`, `question`, a `choices` object, and the `answer` and `reason` fields from the source question bank. Community discussions are excluded.