# Preliminary Round Training endpoints

## Shared types

```ts
type SectionType = 'single_choice' | 'program_reading' | 'program_completion';
type QuestionType = 'choice' | 'true_false';

interface ChoiceOption { id: string; text: string }
interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  score: number; // positive integer, maximum 1000
  explanation: string;
  answer: string; // option id, or "true" / "false"
  options?: ChoiceOption[];
}
interface Section {
  id: string;
  type: SectionType;
  title: string;
  content: string;
  questions: Question[];
}
interface PaperDefinition { title: string; content: string; sections: Section[] }

// Draft-input shape for save requests: normalization fills omitted fields,
// and every normalized stored Question carries a (possibly empty) explanation.
interface QuestionInput {
  id: string;
  type: QuestionType;
  prompt: string;
  score: number; // positive integer, maximum 1000
  explanation?: string;
  answer: string; // option id, or "true" / "false"
  options?: ChoiceOption[];
}
interface SectionInput { id: string; type: SectionType; title: string; content: string; questions: QuestionInput[] }
interface PaperDefinitionInput { title: string; content: string; sections: SectionInput[] }
type Answers = Record<string, string>;
```

IDs use 1-64 ASCII letters, digits, `_`, or `-` and must be unique across sections and questions; option IDs must be unique within their question. A paper has at most 100 sections and 200 questions. Choice questions have at most 26 options. Only program-reading sections accept true/false questions. Publishing additionally requires nonempty section titles, program passages, question prompts, at least two options per choice question, and valid answer references. Explanations are optional in submitted definitions.

## `GET /preliminary`

Description: list visible papers or the current user's immutable attempt history. Draft visibility follows edit ownership. Query `type Query={page?:PositiveInt;q?:string;view?:"papers"|"attempts"}`. Guests cannot select personal history.

Paper response:

```ts
type Response = {
  view: 'papers';
  papers: Array<{
    docId: ObjectId; owner: number; title: string; content: string;
    published: boolean; revision: number; nAttempt: number; updatedAt: Date;
    questionCount: number; totalScore: number;
  }>;
  page: number; pcount: number; q: string;
};
```

Example: `GET /preliminary?page=1&q=CSP` -> `{"view":"papers","papers":[],"page":1,"pcount":0,"q":"CSP"}`.

Attempt-history response uses `view:"attempts"` and `attempts:Array<{docId,paperId,revision,title,score,totalScore,submittedAt}>`; `q` is empty. Example: `GET /preliminary?view=attempts` -> `{"view":"attempts","attempts":[],"page":1,"pcount":0,"q":""}`.

## `GET /preliminary/:paperId`

Description: render a published paper or an authorized draft preview. Response `type Response={paper:PublicPaper;attempts:AttemptSummary[];owner:User;canEdit:boolean;canSubmit:boolean}`. `PublicPaper.sections[].questions[]` includes the prompt, type, score, and options but never includes `answer` or `explanation`. The attempt list contains at most the current user's latest 20 attempts.

Example: `GET /preliminary/68b6...` -> `{"paper":{"docId":"68b6...","title":"CSP-J 2025","revision":2,"sections":[]},"attempts":[],"canEdit":false,"canSubmit":true}`. An unauthorized draft returns `PreliminaryPaperNotPublishedError`.

## `POST /preliminary/:paperId` operation `submit`

Description: grade and store one immutable attempt. Requires profile privilege and `PERM_SUBMIT_PROBLEM`; rate limit is 20 requests per 60 seconds per user. The paper must currently be published. `revision` may identify an older immutable revision the user loaded before an immediate paper update.

Request `type Request={operation:"submit";revision:PositiveInt;answers:Answers}`. Missing question keys are unanswered; unknown question IDs, invalid option IDs, and invalid true/false values fail validation.

```json
{"operation":"submit","revision":2,"answers":{"q1":"option-b","q2":"true"}}
```

Response `type Response={attemptId:ObjectId;score:number;totalScore:number;url:string}`. Example: `{"attemptId":"68b7...","score":92,"totalScore":100,"url":"/preliminary/68b6.../attempt/68b7..."}`. Browser negotiation redirects to the result URL.

## `GET /preliminary/:paperId/attempt/:attemptId`

Description: return one result to its owner. Response `type Response={attempt:AttemptDoc;paper:ReviewPaper}`. Every review question contains `{result:{questionId,answer?,correct,score,maxScore}}`; only incorrect or unanswered questions additionally contain `correctAnswer`, and `explanation` when the question has one. Correct questions omit both fields. Other users receive `PreliminaryAttemptNotFoundError`.

## `GET /preliminary/create` and `GET /preliminary/:paperId/edit`

Description: render the structured editor. Create requires `PERM_CREATE_PROBLEM`; edit requires ownership plus `PERM_EDIT_PROBLEM_SELF`, or `PERM_EDIT_PROBLEM`. Response `type Response={page_name:"preliminary_create"|"preliminary_edit";paper:PaperSummary|null;definition:PaperDefinition}`. Unlike public detail, the authorized editor definition includes answer keys and explanations.

## `POST /preliminary/create` and `POST /preliminary/:paperId/edit` operation `save`

Description: save a draft, publish, update a published paper immediately, or unpublish. Request `type Request={operation:"save";definition:PaperDefinitionInput;published:boolean}`. Normalization accepts the draft-input shape and stores the required normalized `Question` shape, filling omitted explanations with an empty string.

```json
{
  "operation":"save",
  "published":true,
  "definition":{"title":"CSP-J 2025","content":"Practice","sections":[]}
}
```

The example shape is syntactically valid but publication fails until it contains a complete section and question. A successful response is `type Response={paperId:ObjectId;url:string}` and redirects to `/preliminary/:paperId`. Every save with `published:true` creates and activates a new immutable revision; `published:false` creates or updates a draft without a revision.

## `POST /preliminary/:paperId` operation `delete`

Description: permanently delete the paper and all of its revision snapshots, attempts, and score history. Request `{"operation":"delete"}`. Requires the corresponding problem edit permission. Response redirects to `/preliminary`; JSON negotiation returns `{"url":"/preliminary"}`.
