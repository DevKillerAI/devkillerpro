"""Send the redacted OTLP snapshot using Phoenix's protobuf transport."""
import json
from pathlib import Path
from urllib.request import Request, urlopen
from google.protobuf.json_format import ParseDict
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest, ExportTraceServiceResponse

source = Path(__file__).resolve().parents[2] / '.devkiller/evaluations/retrieval-otel.json'
message = ParseDict(json.loads(source.read_text(encoding='utf-8')), ExportTraceServiceRequest())
request = Request('http://127.0.0.1:6006/v1/traces', data=message.SerializeToString(), headers={'Content-Type':'application/x-protobuf'}, method='POST')
with urlopen(request, timeout=10) as response:
    result = ExportTraceServiceResponse.FromString(response.read())
    if result.partial_success.rejected_spans:
        raise RuntimeError('Phoenix partially rejected the snapshot')
    print(json.dumps({'status':response.status,'spans':sum(len(scope.spans) for resource in message.resource_spans for scope in resource.scope_spans),'sent':True}))
