import React, { useEffect, useState } from 'react'

// Components
import TopfiveComponent from './TopfiveComponent'

// Page CSS
import './Topfive.style.css'


const Topfive = () => {

    const [rankingList, setRankingList] = useState([]);

    const getRanking =async()=>{
      // let url = `http://localhost:3000/rankings`;
      let url = `http://https://port-0-kortripfollow-mhg6zzrn5356f2c9.sel3.cloudtype.app/rankings`;
      let response = await fetch(url);
      let data = await response.json();

      // id가 1~5인 항목만 필터링
      const topFive = data.filter(item => item.id >= 1 && item.id <= 5);

      // id 순으로 정렬 (혹시 순서가 섞일 경우 대비)
      topFive.sort((a, b) => a.id - b.id);

      // console.log(topFive);
      setRankingList(topFive);
    }

    useEffect(()=>{
      getRanking()
    },[])
  
  return (
    <div>
      <section className="top-places">
        <h3>채널 추천 여행지 TOP 5</h3>
        <div className="cards">
          {rankingList.map((menu)=>(
            <TopfiveComponent key={menu.id} item={menu} />
          ))}
        </div>
      </section>
    </div>
  )
}

export default Topfive
