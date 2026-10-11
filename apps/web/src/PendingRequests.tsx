import { useState } from "react";
export default function PendingRequests({
  pending,
  reply,
}: {
  pending: any;
  reply: (kind: string, id: string, body: any) => Promise<any>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <>
      {(pending?.permissions ?? []).map((p: any) => (
        <div className="chat-message" key={p.id}>
          <strong>Agent 请求授权</strong>
          <p>
            {p.permission} · {(p.patterns ?? []).join(", ")}
          </p>
          <button onClick={() => reply("permission", p.id, { reply: "once" })}>
            允许本次
          </button>
          <button
            onClick={() => reply("permission", p.id, { reply: "reject" })}
          >
            拒绝
          </button>
        </div>
      ))}
      {(pending?.questions ?? []).map((q: any) => (
        <div className="chat-message" key={q.id}>
          <strong>需要确认</strong>
          {q.questions.map((question: any, i: number) => (
            <label key={i}>
              {question.question}
              <input
                list={q.id + "-" + i}
                value={answers[q.id + "-" + i] ?? ""}
                onChange={(e) =>
                  setAnswers({ ...answers, [q.id + "-" + i]: e.target.value })
                }
              />
              <datalist id={q.id + "-" + i}>
                {question.options.map((option: any) => (
                  <option key={option.label} value={option.label}>
                    {option.description}
                  </option>
                ))}
              </datalist>
            </label>
          ))}
          <button
            onClick={() =>
              reply("question", q.id, {
                answers: q.questions.map((_: any, i: number) => [
                  answers[q.id + "-" + i] ?? "",
                ]),
              })
            }
          >
            提交回答
          </button>
        </div>
      ))}
    </>
  );
}
