import test from "node:test";
import assert from "node:assert/strict";
import {formatReviewTime,maskReviewTime,parseReviewTime,validReviewSecond,MAX_REVIEW_SECOND} from "../src/features/reviews/review-timecode.ts";
test("video timestamp mask strips letters and limits digits",()=>{
  assert.equal(maskReviewTime("01:25"),"01:25");
  assert.equal(maskReviewTime("0125"),"01:25");
  assert.equal(maskReviewTime("1:25"),"1:25");
  assert.equal(maskReviewTime("1a2<script>34"),"12:34");
  assert.equal(maskReviewTime(""),"");
  assert.equal(maskReviewTime("123456789"),"1234:56");
});
test("video timestamps parse seconds exactly and reject invalid minute/second values",()=>{
  assert.equal(parseReviewTime(""),null);
  assert.equal(parseReviewTime("00:00"),0);
  assert.equal(parseReviewTime("1:25"),85);
  assert.equal(parseReviewTime("2879:59"),172799);
  assert.equal(parseReviewTime("2880:00"),172800);
  for(const value of ["test","01:60","-1:02","1:2","24:999","2880:01","9999:00"])
    assert.ok(Number.isNaN(parseReviewTime(value)),value);
});
test("video timestamp validity respects media duration and server limit",()=>{
  assert.equal(validReviewSecond(null,10),true);
  assert.equal(validReviewSecond(10,10.8),true);
  assert.equal(validReviewSecond(11,10.8),false);
  assert.equal(validReviewSecond(-1,null),false);
  assert.equal(validReviewSecond(Number.NaN,null),false);
  assert.equal(validReviewSecond(MAX_REVIEW_SECOND+1,null),false);
  assert.equal(formatReviewTime(85.9),"1:25");
  assert.equal(formatReviewTime(-12),"0:00");
});
