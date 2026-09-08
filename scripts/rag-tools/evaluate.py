"""Evaluate a frozen retrieval report with Ragas, without an LLM or API key."""
import os
os.environ['RAGAS_DO_NOT_TRACK'] = 'true'
import asyncio
import json
import sys
from pathlib import Path
from ragas.dataset_schema import SingleTurnSample
from ragas.metrics import IDBasedContextPrecision, IDBasedContextRecall

async def main():
    source = Path(sys.argv[1]).resolve()
    data = json.loads(source.read_text(encoding='utf-8'))
    precision, recall = IDBasedContextPrecision(), IDBasedContextRecall()
    scores = []
    for row in data['rows']:
        sample = SingleTurnSample(retrieved_context_ids=row['retrieved_context_ids'], reference_context_ids=row['reference_context_ids'])
        # Ragas returns NaN for an empty retrieved set; explicitly count abstention as 0 here.
        scores.append({'anchorPrecision': await precision.single_turn_ascore(sample) if row['retrieved_context_ids'] else 0.0, 'anchorRecall': await recall.single_turn_ascore(sample)})
    result = {'tool':'ragas','version':'0.4.3','benchmark':data['benchmark'],'corpusHash':data['corpusHash'],'cases':len(scores),
              'meanAnchorPrecision':sum(s['anchorPrecision'] for s in scores)/len(scores),
              'meanAnchorRecall':sum(s['anchorRecall'] for s in scores)/len(scores),
              'emptyPrecisionPolicy':'zero (no retrieved contexts)', 'limitation':data['limitation'],'scores':scores}
    target = source.with_suffix('.ragas.json')
    target.write_text(json.dumps(result,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k != 'scores'}))

if __name__ == '__main__': asyncio.run(main())
