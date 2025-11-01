import React from 'react'

// Components
import Header from '../Header/Header'
import Footer from '../footer/Footer'

// Page css
import './About.style.css'

const About = () => {

  return (
    <>
      <Header/>
      <div className='aboutCover'>
        <h1 className="about-title">일상의 발걸음, 국내의 숨겨진 이야기</h1>
          <p className="about-slogan">
            멀리 떠나지 않아도, 가까운 곳에서 새로운 풍경을 만날 수 있습니다.<br/>
            작은 여행 속 큰 설렘을, 함께 발견해보세요.
          </p>
          <p className="about-description">
            여행을 좋아하고 국내 곳곳의 숨은 명소를 소개하는 개인 개발자입니다.<br/>
            직접 다녀온 곳은 실사를 남기며 가능하면 리뷰도 남겨 더욱 자세한 정보를 공유하려합니다.<br/>
            다녀오지 못한 곳들은 그림으로 남기고 훗날 다녀오면 실사진으로 변경할 예정입니다.<br/>
            느리지만 꾸준히 업데이트하며, 앞으로는 맛집과 카페 정보도 더해 풍성한 여행 가이드가 될 예정입니다.
          </p>
      </div>
      <Footer/>
    </>
  )
}

export default About
